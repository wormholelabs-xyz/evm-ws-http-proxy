# EVM WebSocket to HTTP Proxy

> ⚠️ This service is provided for testing purposes only. It is not intended for production use.

## Install Dependencies

Requires [Node JS](https://nodejs.org/en/download/package-manager).

```bash
npm ci
```

## Run

```bash
RPC="<YOUR_EVM_RPC>" npm start
```

### Environment Variables

- `RPC` - Required, the HTTP endpoint to proxy. e.g. https://ethereum-sepolia-rpc.publicnode.com
- `PORT` - Default: `8080`, the port to host the websocket.
- `SLEEP` - Default: `1000`, the duration, in milliseconds, to sleep between polling for blocks and logs.
- `LOG_LEVEL` - Default: `info`, the log level passed to [winston](https://www.npmjs.com/package/winston).

## Test

```bash
npm test
```
