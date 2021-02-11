import axios from 'axios'

axios.defaults.baseURL = 'https://api.welcome.kakao.com'
axios.defaults.proxy = {
    host: 'localhost',
    port: 8000,
}

interface Call {
    id: number
    timestamp: number
    start: number
    end: number
}

interface iElevator {
    id: number
    floor: number
    passengers: Call[]
    status: ElevatorStatus
}

type ElevatorStatus =
    | 'STOPPED' | 'OPENED' | 'UPWARD' | 'DOWNWARD'

interface Command {
    elevator_id: number
    command: CommandString
    call_ids?: number[]
}

type CommandString = 'ENTER' | 'STOP' | 'OPEN' | 'EXIT' | 'CLOSE' | 'UP' | 'DOWN'

interface Respond {
    token: string
    timestamp: number
    elevators: iElevator[]
    calls: Call[]
    is_end: boolean
}

class CallDB {
    set: Set<Call>
    constructor(private _calls: Call[]) {
        this.set = new Set(_calls)
    }

    remove(call: Call) {
        this.set.delete(call)
    }

    *calls() {
        const arr = [...this.set.values()].sort((a, b) => a.start - b.start)
        for (const call of arr)
            yield call
    }
}

const MAX_PASSENGERS_CAPACITY = 8

class Elevator implements iElevator {
    direction?: 'UP' | 'DOWN' | null
    command: CommandString
    constructor(public id: number, public floor: number, public passengers: Call[], public status: ElevatorStatus, public maxHeight: number, public waitingCalls: CallDB) {
        this.command = 'STOP'
    }

    calculate(): Command {
        switch (this.status) {
            case 'STOPPED': {
                if (this.exitExists()) { // case 1
                    return this.open()
                } else if (this.enterExists() && !this.full()) {
                    return this.open()
                } else { // case 2
                    if (!this.empty()) { // 사람이 있을경우
                        const direction = this.getDirection()
                        switch (direction) {
                            case 'UP':
                                return this.up()

                            case 'DOWN':
                                return this.down()

                            case null:
                                throw new Error()
                        }
                    } else {
                        const { down, up } = this.lookup()

                        if (up > 0 || down > 0) {
                            if (up > down) {
                                return this.up()
                            } else if (down > up) {
                                return this.down()
                            } else {
                                // 동일할경우, 끝 지점(가장 밑, 가장 위)이 더 가까운 방향을 선택
                                if (this.floor >= Math.floor(MAX_HEIGHT / 2))
                                    return this.up()
                                else
                                    return this.down()
                            }
                        } else {
                            return this.stop()
                        }
                    }
                }
            } break

            case 'OPENED': {
                if (this.exitExists()) {
                    return this.exit()
                } else if (this.enterExists() && !this.full()) {
                    return this.enter()
                } else {
                    return this.close()
                }
            } break

            case 'UPWARD':
            case 'DOWNWARD': {
                if (this.exitExists()) {
                    return this.stop()
                } else if (this.enterExists()) {
                    if (this.full()) {
                        return this.keepGoing()
                    } else {
                        return this.stop()
                    }
                } else if (this.floor === 1 || this.floor === MAX_HEIGHT) {
                    return this.stop()
                } else {
                    const { down, up } = this.lookup()

                    if (this.status === 'UPWARD') {
                        if (up > 0) {
                            return this.keepGoing()
                        } else {
                            return this.stop()
                        }
                    } else {
                        if (down > 0) {
                            return this.keepGoing()
                        } else {
                            return this.stop()
                        }
                    }
                }
            } break
        }

        throw new Error('Undefined Behaviour')
    }

    private exitExists(): boolean {
        return this.passengers.filter(d => d.end === this.floor).length > 0
    }

    private enterExists(): boolean {
        return [...this.waitingCalls.calls()].filter(d => d.start === this.floor).length > 0
    }

    private empty(): boolean {
        return this.passengers.length === 0
    }

    private full(): boolean {
        return this.passengers.length === MAX_PASSENGERS_CAPACITY
    }

    private getDirectionCounter() { // ??????????
        let up = 0, down = 0
        for (const call of this.passengers) {
            const delta = call.end - call.start
            if (delta > 0)
                up++
            else
                down++
        }

        return {
            up, down
        }
    }

    private getDirection(): 'UP' | 'DOWN' | null {
        if (this.direction !== undefined)
            return this.direction

        let up = 0, down = 0
        for (const call of this.passengers) {
            const delta = call.end - call.start
            if (delta > 0)
                up++
            else
                down++
        }

        if (up > 0 || down > 0) {
            if (up > down)
                this.direction = 'UP'
            else if (up < down)
                this.direction = 'DOWN'
            else {
                if (this.floor >= Math.floor(this.maxHeight / 2))
                    this.direction = 'UP'
                else
                    this.direction = 'DOWN'
            }
        } else {
            this.direction = null
        }

        return this.direction
    }

    private lookup() { // 현재 층을 제외한 태울 수 있는 사람들
        let up = 0, down = 0
        for (const call of this.waitingCalls.calls()) {
            if (call.start > this.floor)
                up++
            else if (call.start < this.floor)
                down++
        }

        return { up, down }
    }

    private up(): Command {
        return {
            command: 'UP',
            elevator_id: this.id
        }
    }

    private down(): Command {
        return {
            command: 'DOWN',
            elevator_id: this.id
        }
    }

    private keepGoing(): Command {
        if (this.status === 'UPWARD') {
            return {
                command: 'UP',
                elevator_id: this.id
            }
        }

        if (this.status === 'DOWNWARD') {
            return {
                command: 'DOWN',
                elevator_id: this.id
            }
        }

        const direction = this.getDirection()
        if (direction === null)
            throw new Error()

        return {
            command: direction,
            elevator_id: this.id
        }
    }

    private stop(): Command {
        return {
            command: 'STOP',
            elevator_id: this.id
        }
    }

    private open(): Command {
        return {
            command: 'OPEN',
            elevator_id: this.id
        }
    }

    enter(): Command {
        const availableCapacity = MAX_PASSENGERS_CAPACITY - this.passengers.length
        let direction = this.getDirection()
        let calls = [...this.waitingCalls.calls()].filter(d => d.start === this.floor)
        if (direction === 'UP')
            calls = calls.filter(d => d.end - d.start > 0)
        else if (direction === 'DOWN')
            calls = calls.filter(d => d.end - d.start < 0)
        calls = calls.slice(0, availableCapacity)

        if (calls.length === 0)
            calls = [...this.waitingCalls.calls()].filter(d => d.start === this.floor).slice(0, availableCapacity)

        calls.map(d => this.waitingCalls.remove(d))

        return {
            command: 'ENTER',
            elevator_id: this.id,
            call_ids: calls.map(d => d.id)
        }
    }

    exit(): Command {
        const calls = this.passengers.filter(d => d.end === this.floor)

        return {
            command: 'EXIT',
            elevator_id: this.id,
            call_ids: calls.map(d => d.id)
        }
    }

    close(): Command {
        return {
            command: 'CLOSE',
            elevator_id: this.id
        }
    }
}

let PROBLEM_NUMBER = 2
let MAX_HEIGHT = -1
const ELEVATOR_COUNT = 4

switch (PROBLEM_NUMBER) {
    case 0: {
        MAX_HEIGHT = 5
    } break

    case 1:
    case 2: {
        MAX_HEIGHT = 25
    } break
}

async function loop() {
    let handledCall = 0
    let totalCommandCount = 0
    while (true) {
        // await new Promise(res => setTimeout(res, 500)) // 0.5초마다 실행

        const { data, status } = await axios.get<Respond>('/oncalls')

        const { calls, elevators, is_end, timestamp, token } = data
        const callDB = new CallDB(calls)

        if (is_end)
            break

        const commands: Command[] = []

        for (const { floor, id, passengers, status } of elevators) {
            const command = new Elevator(id, floor, passengers, status, MAX_HEIGHT, callDB).calculate()
            commands.push(command)
        }

        commands.map(c => {
            if (c.command === 'EXIT')
                handledCall += (c.call_ids?.length || 0)
        })

        try {
            console.log(`handled_calls: ${handledCall}, totalCommands: ${totalCommandCount}`)
            // console.log(`CMD: ${commands[0].command}, ids: ${commands[0].call_ids}`)
            const respond = await axios.post('/action', {
                commands
            })
            totalCommandCount += 1
        } catch (err) {
            console.error(err)
        }
    }
}

async function main() {
    const respond = await axios.post(`/start/tester/${PROBLEM_NUMBER}/${ELEVATOR_COUNT}`)
    const { token } = respond.data
    axios.defaults.headers['X-Auth-Token'] = token
    loop()
}

try {
    main()
} catch (err) {
    console.error(err)
}