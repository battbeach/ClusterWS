import * as HTTP from 'http'
import { EventEmitterSingle } from '../emitter/single'
import { Listener, Message, CustomObject } from '../../utils/types'

// tslint:disable-next-line
const noop: Listener = (): void => { }
const OPEN: number = 1
const CLOSED: number = 0
const OPCODE_PING: number = 9
const OPCODE_TEXT: number = 1
const OPCODE_BINARY: number = 2
const PERMESSAGE_DEFLATE: number = 1
const DEFAULT_PAYLOAD_LIMIT: number = 16777216

const native: any = ((): void => {
  try {
    return require(`./node/uws_${process.platform}_${process.versions.modules}`)
  } catch (e) {
    const version: any = process.version.substring(1).split('.').map((n: any) => parseInt(n, 10))
    const lessThanSixFour: any = version[0] < 6 || (version[0] === 6 && version[1] < 4)

    if (process.platform === 'win32' && lessThanSixFour)
      throw new Error('µWebSockets requires Node.js 6.4.0 or greater on Windows.')

    throw new Error('Compilation of µWebSockets has failed and there is no pre-compiled binary ' +
      'available for your system. Please install a supported C++11 compiler and reinstall the module \'uws\'.')
  }
})()

native.setNoop(noop)

class ServerWebsocketClient {
  public onping: Listener = noop
  public onpong: Listener = noop
  public external: Listener | CustomObject = noop
  public internalOnOpen: Listener = noop
  public internalOnError: Listener = noop
  public internalOnClose: Listener = noop
  public internalOnMessage: Listener = noop

  constructor(external: CustomObject) {
    this.external = external
  }

  public on(eventName: string, listener: Listener): this {
    const actions: any = {
      message: (): any => this.internalOnMessage = listener,
      close: (): any => this.internalOnClose = listener,
      ping: (): any => this.onping = listener,
      pong: (): any => this.onpong = listener,
      open: (): any => this.internalOnOpen = listener,
      error: (): any => this.internalOnError = listener
    }
    actions[eventName] ? actions[eventName].call(this) : null
    return this
  }

  public ping(message: Message): void {
    // console.log('Ping')
    if (this.external) native.server.send(this.external, message, OPCODE_PING)
  }

  public terminate(): void {
    // console.log('terminate')
    if (this.external) {
      native.server.terminate(this.external)
      this.external = null
    }
  }

  public send(message: Message, options?: CustomObject, cb?: Listener): void {
    // console.log('send')
    if (this.external) {
      if (typeof options === 'function') {
        cb = options
        options = null
      }
      const binary: boolean = options && options.binary || typeof message !== 'string'
      native.server.send(this.external, message, binary ? OPCODE_BINARY : OPCODE_TEXT, cb ? ((): void => process.nextTick(cb)) : undefined)
    } else if (cb) cb(new Error('not opened'))
  }

  public close(code: number, reason: string): void {
    console.log('close')
    if (this.external) {
      native.server.close(this.external, code, reason)
      this.external = null
    }
  }

  get OPEN(): number {
    return OPEN
  }

  get CLOSED(): number {
    return CLOSED
  }

  get readyState(): number {
    console.log('ready')
    return this.external ? OPEN : CLOSED
  }
}

class Server extends EventEmitterSingle {
  public noDelay: any
  public upgradeReq: any = null
  public httpServer: HTTP.Server
  public serverGroup: any
  public upgradeCallback: any = noop
  public upgradeListener: any = null
  public passedHttpServer: any
  public lastUpgradeListener: boolean = true

  constructor(options: CustomObject, callback: Listener) {
    super()

    if (!options) throw new TypeError('missing options')
    if (!options.port && !options.server && !options.noServer) throw new TypeError('invalid options')

    const nativeOptions: number = options.perMessageDeflate === false ? 0 : PERMESSAGE_DEFLATE
    this.serverGroup = native.server.group.create(nativeOptions, options.maxPayload || DEFAULT_PAYLOAD_LIMIT)

    this.noDelay = options.noDelay || true
    this.passedHttpServer = options.server
    if (!options.noServer) {
      this.httpServer = options.server || HTTP.createServer((request: any, response: any) => response.end())

      if (options.path && (!options.path.length || options.path[0] !== '/'))
        options.path = `/${options.path}`

      this.httpServer.on('upgrade', this.upgradeListener = ((request: any, socket: any, head: any): void => {
        if (!options.path || options.path === request.url.split('?')[0].split('#')[0]) {
          if (options.verifyClient) {
            const info: any = {
              origin: request.headers.origin,
              secure: !!(request.connection.authorized || request.connection.encrypted),
              req: request
            }

            if (options.verifyClient.length === 2) {
              options.verifyClient(info, (result: any, code: any, name: any): void => result ?
                this.handleUpgrade(request, socket, head, this.emitConnection) :
                this.abortConnection(socket, code, name))
            } else {
              options.verifyClient(info) ?
                this.handleUpgrade(request, socket, head, this.emitConnection) :
                this.abortConnection(socket, 400, 'Client verification failed')
            }

          } else this.handleUpgrade(request, socket, head, this.emitConnection)
        } else if (this.lastUpgradeListener) this.abortConnection(socket, 400, 'URL not supported')
      }))

      this.httpServer.on('newListener', (eventName: any, listener: Listener) => eventName === 'upgrade' ? this.lastUpgradeListener = false : null)
      this.httpServer.on('error', (err: any) => this.emit('error', err))
    }

    native.server.group.onDisconnection(this.serverGroup, (external: any, code: any, message: any, webSocket: any): void => {
      webSocket.external = null
      process.nextTick(() => webSocket.internalOnClose(code, message))
      native.clearUserData(external)
    })
    native.server.group.onMessage(this.serverGroup, this.sendMessage)
    native.server.group.onPing(this.serverGroup, (message: any, webSocket: any): void => webSocket.onping(message))
    native.server.group.onPong(this.serverGroup, (message: any, webSocket: any): void => webSocket.onpong(message))
    native.server.group.onConnection(this.serverGroup, (external: any): void => {
      const webSocket: any = new ServerWebsocketClient(external)
      native.setUserData(external, webSocket)
      this.upgradeCallback(webSocket)
      this.upgradeReq = null
    })

    if (options.port) {
      this.httpServer.listen(options.port, options.host || null, (): void => {
        this.emit('listening')
        callback && callback()
      })
    }
  }

  public handleUpgrade(request: any, socket: any, upgradeHead: any, callback: Listener): void {
    if (socket._isNative) {
      if (this.serverGroup) {
        this.upgradeReq = request
        this.upgradeCallback = callback ? callback : noop
        native.upgrade(this.serverGroup, socket.external, null, request.headers['sec-websocket-extensions'], request.headers['sec-websocket-protocol'])
      }
    } else {
      const secKey: any = request.headers['sec-websocket-key']
      const socketHandle: any = socket.ssl ? socket._parent._handle : socket._handle
      const sslState: any = socket.ssl ? socket.ssl._external : null
      if (socketHandle && secKey && secKey.length === 24) {
        socket.setNoDelay(this.noDelay)
        const ticket: any = native.transfer(socketHandle.fd === -1 ? socketHandle : socketHandle.fd, sslState)
        socket.on('close', (error: any): void => {
          if (this.serverGroup) {
            this.upgradeReq = request
            this.upgradeCallback = callback ? callback : noop
            native.upgrade(this.serverGroup, ticket, secKey, request.headers['sec-websocket-extensions'], request.headers['sec-websocket-protocol'])
          }
        })
      }
      socket.destroy()
    }
  }

  public close(cb: Listener): void {
    if (this.upgradeListener && this.httpServer) {
      this.httpServer.removeListener('upgrade', this.upgradeListener)
      if (!this.passedHttpServer) this.httpServer.close()
    }

    if (this.serverGroup) {
      native.server.group.close(this.serverGroup)
      this.serverGroup = null
    }

    // compatibility hack, 20 seconds timeout
    if (typeof cb === 'function')
      setTimeout(cb, 20000)
  }

  public sendMessage(message: any, webSocket: any): void {
    webSocket.internalOnMessage(message)
  }

  public emitConnection(ws: any): void {
    this.emit('connection', ws)
  }

  public abortConnection(socket: any, code: any, name: any): void {
    socket.end(`HTTP/1.1 ${code} ${name}\r\n\r\n`)
  }
}

export class WebSocket {
  public static server: any = Server

  public onping: Listener = noop
  public onpong: Listener = noop
  public external: Listener = noop
  public internalOnOpen: Listener = noop
  public internalOnError: Listener = noop
  public internalOnClose: Listener = noop
  public internalOnMessage: Listener = noop
  public clientGroup: any

  constructor(uri: string) {
    this.external = null

    this.clientGroup = native.client.group.create(0, DEFAULT_PAYLOAD_LIMIT)
    native.connect(this.clientGroup, uri, this)

    native.client.group.onPing(this.clientGroup, (message: Message, webSocket: any): void => webSocket.onping(message))
    native.client.group.onPong(this.clientGroup, (message: Message, webSocket: any): void => webSocket.onpong(message))
    native.client.group.onDisconnection(this.clientGroup, (external: any, code: any, message: any, webSocket: any): void => {
      webSocket.external = null
      process.nextTick((): void => webSocket.internalOnClose(code, message))
      native.clearUserData(external)
    })
    native.client.group.onError(this.clientGroup, (webSocket: any): void => process.nextTick((): void => webSocket.internalOnError({
      message: 'uWs client connection error',
      stack: 'uWs client connection error'
    })))

    native.client.group.onMessage(this.clientGroup, (message: any, webSocket: any): void => webSocket.internalOnMessage(message))
    native.client.group.onConnection(this.clientGroup, (external: any): void => {
      const webSocket: any = native.getUserData(external)
      webSocket.external = external
      webSocket.internalOnOpen()
    })
  }

  public on(eventName: string, listener: Listener): WebSocket {
    const actions: any = {
      message: (): any => this.internalOnMessage = listener,
      close: (): any => this.internalOnClose = listener,
      ping: (): any => this.onping = listener,
      pong: (): any => this.onpong = listener,
      open: (): any => this.internalOnOpen = listener,
      error: (): any => this.internalOnError = listener
    }
    actions[eventName] ? actions[eventName].call(this) : null
    return this
  }

  public ping(message: Message): void {
    if (this.external) native.client.send(this.external, message, OPCODE_PING)
  }

  public terminate(): void {
    if (this.external) {
      native.client.terminate(this.external)
      this.external = null
    }
  }

  public send(message: Message, options?: CustomObject, cb?: Listener): void {
    console.log('CLient send')
    if (this.external) {
      if (typeof options === 'function') {
        cb = options
        options = null
      }
      const binary: boolean = options && options.binary || typeof message !== 'string'
      native.client.send(this.external, message, binary ? OPCODE_BINARY : OPCODE_TEXT, cb ? ((): void => process.nextTick(cb)) : undefined)
    } else if (cb) cb(new Error('not opened'))
  }

  public close(code: number, reason: string): void {
    console.log('CLient close')
    if (this.external) {
      native.client.close(this.external, code, reason)
      this.external = null
    }
  }

  get OPEN(): number {
    return OPEN
  }

  get CLOSED(): number {
    return CLOSED
  }

  get readyState(): number {
    console.log('ready')
    return this.external ? OPEN : CLOSED
  }
}