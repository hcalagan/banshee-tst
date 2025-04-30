import type { TPossibleTxEvents } from '@/types'
import { IIbcEngageBundle, IWebsocketCore } from '@/interfaces'

import { Responses as T34Responses } from '@cosmjs/tendermint-rpc/build/tendermint34/adaptor'
import { Responses as C38Responses } from '@cosmjs/tendermint-rpc/build/comet38/adaptor'
import { tidyString } from '@/utils/misc'

export class WebsocketCore implements IWebsocketCore {
  protected readonly wsConnections: Record<string, WebSocket>
  protected readonly wsFeeds: Record<string, TPossibleTxEvents[]>

  constructor() {
    this.wsConnections = {}
    this.wsFeeds = {}
  }

  monitor<T extends TPossibleTxEvents>(
    connections: IIbcEngageBundle<T> | IIbcEngageBundle<T>[],
  ): void {
    try {
      if (connections instanceof Array) {
        for (let conn of connections) {
          this.setupMonitoring<T>(conn)
        }
      } else {
        this.setupMonitoring<T>(connections)
      }
    } catch (err) {
      throw err
    }
  }

  protected setupMonitoring<T extends TPossibleTxEvents>(
    conn: IIbcEngageBundle<T>,
  ): void {
    try {
      if (
        !conn.endpoint.startsWith('ws://')
        && !conn.endpoint.startsWith('wss://')
      ) {
        throw new Error('invalid url')
      }

      const cleanEndpoint = tidyString(conn.endpoint, '/')
      const finalEndpoint = cleanEndpoint.endsWith('websocket')
        ? cleanEndpoint
        : `${cleanEndpoint}/websocket`
      if (!this.wsConnections[conn.chainId]) {
        this.wsConnections[conn.chainId] = new WebSocket(finalEndpoint)
      }
      const client = this.wsConnections[conn.chainId]

      const query = conn.query
        ? `tm.event = 'Tx' AND ${conn.query}`
        : `tm.event = 'Tx'`
      const marker = Date.now().toString()
      this.wsFeeds[`${marker}|${query}`] = conn.feed
      const wsQuery = {
        jsonrpc: '2.0',
        method: 'subscribe',
        id: marker,
        params: { query },
      }

      if (client.readyState === 1) {
        client.send(JSON.stringify(wsQuery))
      } else {
        client.onopen = () => {
          client.send(JSON.stringify(wsQuery))
        }
      }

      client.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data)
          if (!data.result || !data.result.data) {
            return
          }

          let ready
          try {
            ready = T34Responses.decodeTxEvent(data.result) as T
          } catch (_) {
            try {
              ready = C38Responses.decodeTxEvent(data.result) as T
            } catch (_) {
              throw new Error('Unable to decode event')
            }
          }

          this.wsFeeds[`${marker}|${data.result.query}`].push(ready)
          this.wsFeeds[`${marker}|${data.result.query}`] = []
        } catch (err) {
          console.error(err)
        }
      }
    } catch (err) {
      throw err
    }
  }
}
