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

const MAX_PASSENGERS = 8

class Elevator implements iElevator {
    direction?: 'UP' | 'DOWN' | null
    constructor(public id: number, public floor: number, public passengers: Call[], public status: ElevatorStatus, public maxHeight: number, public waitingCalls: CallDB) { }

    calculate(): Command {
        const result: Command = {
            command: 'STOP',
            elevator_id: this.id,
            call_ids: []
        }
        switch (this.status) {
            case 'UPWARD': {
                if (this.floor == this.maxHeight) {
                    result.command = 'STOP'
                } else {
                    if (this.PassengerExitThisFloor().length > 0) {
                        result.command = 'STOP'
                    } else if (this.PassengerEnterOnThisFloorWithSameDirection().length > 0) {
                        result.command = 'STOP'
                    } else {
                        const { down, up } = this.callsLookUp(false)
                        if (up > 0)
                            result.command = 'UP'
                        else
                            result.command = 'STOP'
                    }
                }
            } break

            case 'DOWNWARD': {
                if (this.floor === 1) { // FLOOR
                    result.command = 'STOP'
                } else {
                    if (this.PassengerExitThisFloor().length > 0) {
                        result.command = 'STOP'
                    } else if (this.PassengerEnterOnThisFloorWithSameDirection().length > 0) {
                        result.command = 'STOP'
                    } else {
                        const { down } = this.callsLookUp(false)
                        if (down > 0)
                            result.command = 'DOWN'
                        else
                            result.command = 'STOP'
                    }
                }
            } break

            case 'STOPPED': {
                const exitPassengers = this.PassengerExitThisFloor()
                const enterPassengers = this.PassengerEnterOnThisFloorWithSameDirection()
                if (exitPassengers.length > 0 || enterPassengers.length > 0) {
                    result.command = 'OPEN'
                    result.call_ids = exitPassengers.map(d => d.id)
                } else {
                    if (this.passengers.length > 0) {
                        const direction = this.ElevatorDirections()
                        if (direction) {
                            result.command = direction
                        } else { // 방향이 있어야하는데 없다???
                            throw new Error()
                        }
                    } else {
                        const waitingThisFloor = this.WaitingCallsEnterThisFloor()
                        if (waitingThisFloor.length > 0) {
                            result.command = 'OPEN'
                        } else {
                            const { down, up } = this.callsLookUp(true)
                            if (up > 0 || down > 0) {
                                if (up >= down) {
                                    result.command = 'UP'
                                } else {
                                    result.command = 'DOWN'
                                }
                            } else {
                                result.command = 'STOP'
                            }
                        }
                    }
                }
            } break

            case 'OPENED': {
                const exitPassengers = this.PassengerExitThisFloor()

                if (exitPassengers.length > 0) {
                    result.command = 'EXIT'
                    result.call_ids = exitPassengers.map(d => d.id)
                } else {
                    const { up, down } = this.callsLookUp(true)

                    if (up > 0 || down > 0) {
                        let calls = this.WaitingCallsEnterThisFloor()
                        if (calls.length > 0) {
                            result.command = 'ENTER'
                            if (up > down)
                                calls = calls.filter(d => d.end - d.start > 0)
                            else
                                calls = calls.filter(d => d.end - d.start < 0)

                            const availableCount = MAX_PASSENGERS - this.passengers.length
                            const call_ids = calls.slice(0, availableCount)
                            if (call_ids.length > 0) {
                                for (const call of call_ids)
                                    this.waitingCalls.remove(call)

                                result.call_ids = call_ids.map(d => d.id)
                            } else {
                                result.command = 'CLOSE'
                            }
                        } else {
                            result.command = 'CLOSE'
                        }
                    } else {
                        result.command = 'CLOSE'
                    }
                }
            } break
        }

        if (result.call_ids?.length == 0)
            delete result.call_ids
        return result
    }

    PassengerExitThisFloor() {
        return this.passengers.reduce((arr: Call[], p: Call) => {
            if (p.end === this.floor)
                arr.push(p)

            return arr
        }, [])
    }

    WaitingCallsEnterThisFloor() {
        return [...this.waitingCalls.calls()].reduce((arr: Call[], p: Call) => {
            if (p.start === this.floor)
                arr.push(p)

            return arr
        }, [])
    }

    PassengerEnterOnThisFloorWithSameDirection(): Call[] {
        const calls: Call[] = []
        for (const call of this.waitingCalls.calls()) {
            if (call.start === this.floor) {
                const diff = call.end - call.start

                switch (this.ElevatorDirections()) {
                    case 'UP': {
                        if (diff > 0) {
                            calls.push(call)
                            this.waitingCalls.remove(call)
                        }
                    } break

                    case 'DOWN': {
                        if (diff < 0) {
                            calls.push(call)
                            this.waitingCalls.remove(call)
                        }
                    } break
                }
            }
        }

        return calls
    }

    directionCounter() {
        let up = 0, down = 0
        for (const p of this.passengers) {
            if (p.end - p.start > 0)
                up++
            else
                down++
        }

        return { up, down }
    }

    callsLookUp(include: boolean) {
        let up = 0, down = 0
        for (const p of this.waitingCalls.calls()) {
            if (p.start > this.floor)
                up++
            else if (p.start < this.floor)
                down++
            else if (include && p.start === this.floor) {
                up++
                down++
            }
        }

        return { up, down }
    }

    ElevatorDirections(): 'UP' | 'DOWN' | null {
        if (this.direction !== undefined)
            return this.direction

        if (this.passengers.length > 0) {
            const { up, down } = this.directionCounter()

            if (up > down)
                this.direction = 'UP'
            else
                this.direction = 'DOWN'
        } else {
            this.direction = null
        }

        return this.direction
    }

    getUpperLower(): { down: number, up: number } {
        let down = 0, up = 0
        for (const p of this.waitingCalls.calls()) {
            if (p.start < this.floor)
                down++
            else if (p.start > this.floor)
                up++
        }

        return { down, up }
    }
}

let PROBLEM_NUMBER = 1
let MAX_HEIGHT = -1
const ELEVATOR_COUNT = 2

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
    try {
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

            const respond = await axios.post('/action', {
                commands
            })
        }
    } catch (err) {
        console.error(err)
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