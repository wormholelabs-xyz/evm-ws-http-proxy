import axios from "axios";
import WebSocket from "ws";
import { createLogger, format, transports, Logger } from "winston";

// WARNING: this proxy is for testing purposes only!
// TODO: respond with errors

// run with
// LOG_LEVEL="debug" RPC="<YOUR_EVM_RPC>" npm start
// e.g.
// LOG_LEVEL="debug" RPC="https://ethereum-sepolia-rpc.publicnode.com" npm start

// relevant docs
// JSON RPC https://ethereum.org/en/developers/docs/apis/json-rpc/
// WS https://docs.alchemy.com/reference/eth-subscribe

// examples from
// npx wscat --connect wss://ethereum-sepolia-rpc.publicnode.com

// test with
// npx wscat --connect ws://localhost:8080
// or
// npm test

// subscribe new heads
// {"id":1,"jsonrpc":"2.0","method":"eth_subscribe","params":["newHeads"]}

// subscribe Wormhole Core logs on Sepolia
// {"jsonrpc":"2.0","id": 1, "method": "eth_subscribe", "params": ["logs", {"address": "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78", "topics": ["0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2"]}]}

// Guardian subscription looks like
// {"jsonrpc":"2.0","id":1,"method":"eth_subscribe","params":["logs",{"address":["0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78"],"fromBlock":"0x0","toBlock":"latest","topics":[["0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2"],null]}]}

// unsubscribe
// {"id":1,"jsonrpc":"2.0","method":"eth_unsubscribe","params":["0x00000000000000000000000000000001"]}

const RPC = process.env.RPC;
if (!RPC) {
  console.error("RPC is required!");
  process.exit(1);
}
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const SLEEP = process.env.SLEEP ? parseInt(process.env.SLEEP) : 1000;

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.simple(),
    format.errors({ stack: true }),
    format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss.SSS ZZ",
    }),
    format.printf((info) => {
      // log format: [YYYY-MM-DD HH:mm:ss.SSS A ZZ] [level] [source] message
      const source = info.source || "main";
      return `[${info.timestamp}] [${info.level}] [${source}] ${info.message}`;
    })
  ),
  transports: [new transports.Console()],
});

async function sleep(timeout: number) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

const wss = new WebSocket.Server({ port: PORT });

interface Subscription {
  ws: WebSocket;
  id: string;
}
interface LogSubscription extends Subscription {
  address: string;
  topics: string[];
}
let newHeadSubscribers: Subscription[] = [];
let logSubscribers: LogSubscription[] = [];

let nextSubId = BigInt(1);
function getNextSub() {
  // TODO: should these just be random?
  // e.g. 0x07859641bba6dd7d21cdb79d704f679b
  let id = nextSubId++;
  return `0x${id.toString(16).padStart(32, "0")}`;
}

wss.on("connection", (ws: WebSocket) => {
  logger.info("New client connected");

  ws.on("message", (message: string) => {
    logger.debug(`Received message: ${message}`);
    try {
      const json = JSON.parse(message);
      if (!json.id || typeof json.id !== "number") {
        return;
      }
      if (json.method === "eth_subscribe") {
        if (json.params.length === 1 && json.params[0] === "newHeads") {
          // {"id":1,"jsonrpc":"2.0","method":"eth_subscribe","params":["newHeads"]}
          let id = getNextSub();
          newHeadSubscribers.push({ ws, id });
          // {"jsonrpc":"2.0","result":"0x07859641bba6dd7d21cdb79d704f679b","id":1}
          ws.send(`{"jsonrpc":"2.0","result":"${id}","id":${json.id}}`);
        } else if (json.params.length === 2 && json.params[0] === "logs") {
          if (
            typeof json.params[1]?.address === "string" && // single address
            json.params[1]?.topics?.length === 1 && // one topic
            typeof json.params[1]?.topics[0] === "string"
          ) {
            // single array of topics
            // {"jsonrpc":"2.0","id": 1, "method": "eth_subscribe", "params": ["logs", {"address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "topics": ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]}]}
            let id = getNextSub();
            logSubscribers.push({
              ws,
              id,
              address: json.params[1].address,
              topics: json.params[1].topics,
            });
            ws.send(`{"jsonrpc":"2.0","result":"${id}","id":${json.id}}`);
          } else if (
            json.params[1]?.address?.length && // array of addresses
            json.params[1]?.topics?.length >= json.params[1]?.address?.length // array of arrays of topics
          ) {
            // {"jsonrpc":"2.0","id":1,"method":"eth_subscribe","params":["logs",{"address":["0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78"],"fromBlock":"0x0","toBlock":"latest","topics":[["0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2"],null]}]}
            let id = getNextSub();
            for (let idx = 0; idx < json.params[1].address.length; idx++) {
              let address = json.params[1].address[idx];
              let topics = json.params[1].topics[idx];
              if (address && topics && topics.length) {
                logSubscribers.push({
                  ws,
                  id,
                  address,
                  topics,
                });
              }
            }
            ws.send(`{"jsonrpc":"2.0","result":"${id}","id":${json.id}}`);
          }
        }
      } else if (json.method === "eth_unsubscribe") {
        if (json.params.length === 1) {
          // {"jsonrpc":"2.0","id": 1, "method": "eth_unsubscribe", "params": ["0x7529626735859f32962b10b19ee2e3eb"]}
          newHeadSubscribers = newHeadSubscribers.filter(
            (s) => !(s.ws === ws && s.id === json.params[0])
          );
          logSubscribers = logSubscribers.filter(
            (s) => !(s.ws === ws && s.id === json.params[0])
          );
          // {"jsonrpc":"2.0","result":true,"id":1}
          ws.send(`{"jsonrpc":"2.0","result":true,"id":${json.id}}`);
        }
      } else {
        // pass through
        (async () => {
          const response = (
            await axios.post(RPC, json, {
              // don't parse the response
              transformResponse: (x) => x,
            })
          )?.data;
          logger.debug(response);
          ws.send(response);
        })();
      }
    } catch (e) {
      // ignore bad messages
    }
  });

  ws.on("close", () => {
    logger.info("Client disconnected");
    newHeadSubscribers = newHeadSubscribers.filter((s) => s.ws !== ws);
    logSubscribers = logSubscribers.filter((s) => s.ws !== ws);
  });
});

type LogRange = {
  fromBlock: bigint;
  toBlock: bigint;
};
const logRangesToProcess: LogRange[] = [];
async function getLogs(logger: Logger) {
  const range = logRangesToProcess.shift();
  if (RPC && range && logSubscribers.length) {
    logger.info(
      `from block: ${range.fromBlock.toString()}, to block: ${range.toBlock.toString()}`
    );
    for (const s of logSubscribers) {
      try {
        logger.debug(
          `address: ${s.address}, topics: ${JSON.stringify(s.topics)}`
        );
        const result = (
          await axios.post(RPC, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getLogs",
            params: [
              {
                fromBlock: `0x${range.fromBlock.toString(16)}`,
                toBlock: `0x${range.toBlock.toString(16)}`,
                address: s.address,
                topics: s.topics,
              },
            ],
          })
        )?.data?.result;
        if (result && result.length) {
          for (const r of result) {
            // {"jsonrpc":"2.0","method":"eth_subscription","params":{"result":{
            //   "address":"0x4a8bc80ed5a4067f1ccf107057b8270e0cc11a78",
            //   "blockHash":"0xf9636daf7a020e617018a52b3a8b631b492d095ae9a7488a290bb842c3288179",
            //   "blockNumber":"0x695994",
            //   "data":"0x0000000000000000000000000000000000000000000000000000000000009e2200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000f00000000000000000000000000000000000000000000000000000000000001ce0127130000000000000000000000008b949732cee02e7a3f34426907e3d53367990a030000008000000000000000000000000000000000000000000000000000000000000000040000000000000000000000003fadbe3e0c9a4a2eb67a89431d795864cf7402be0000000000000000000000000000000000000000000000001bc16d674ec80000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007a1200000000000000000000000000000000000000000000000000000000005ad37cf27130000000000000000000000008b949732cee02e7a3f34426907e3d53367990a030000000000000000000000007a0a53847776f7e94cc35742971acb2217b0db810000000000000000000000007a0a53847776f7e94cc35742971acb2217b0db8100000000000000000000000020d4d84f0c6aa89e34e9e3b49b2220163d7baaab00000000000000000000000000000000000000",
            //   "logIndex":"0x21",
            //   "removed":false,
            //   "topics":["0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2","0x0000000000000000000000007b1bd7a6b4e61c2a123ac6bc2cbfc614437d0470"],
            //   "transactionHash":"0x064daa635c7b42701d6e49a4ee89feecf30772ab6356aef22c61ae3781fb38fa",
            //   "transactionIndex":"0xf"
            // },"subscription":"0x3457f41006e593d237ac7b1d4a8cce14"}}
            s.ws.send(
              `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":${JSON.stringify(
                r
              )},"subscription":"${s.id}"}}`
            );
          }
        }
      } catch (e) {
        // ignore potentially bad log subscription or block ranges that are too large
        // TODO: env var for max log block range size
      }
    }
  }
}

let prevHead: null | bigint = null;
async function getBlocks(logger: Logger) {
  if (RPC && (newHeadSubscribers.length || logSubscribers.length)) {
    const latestData = (
      await axios.post(RPC, {
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false],
        id: 1,
      })
    )?.data;
    const newHeadStr = latestData?.result?.number;
    if (!newHeadStr) {
      throw new Error(`Invalid block number: ${newHeadStr}`);
    }
    const newHead = BigInt(newHeadStr);
    logger.info(
      `prev head: ${prevHead?.toString()}, new head: ${newHead.toString()}`
    );
    if (prevHead === null) {
      prevHead = newHead - 1n;
    }
    if (logSubscribers.length && prevHead < newHead) {
      logRangesToProcess.push({ fromBlock: prevHead + 1n, toBlock: newHead });
    }
    while (prevHead < newHead) {
      prevHead++;
      if (newHeadSubscribers.length) {
        // TODO: batch these
        const result = (
          await axios.post(RPC, {
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: [`0x${prevHead.toString(16)}`, false],
            id: 1,
          })
        )?.data?.result;
        if (!result) {
          throw new Error(`Invalid result: ${result}`);
        }
        for (let s of newHeadSubscribers) {
          // {"jsonrpc":"2.0","method":"eth_subscription","params":{"result":{
          //   "baseFeePerGas":"0xd85318","blobGasUsed":"0x0","difficulty":"0x0","excessBlobGas":"0x0","extraData":"0xd883010d0b846765746888676f312e32312e36856c696e7578","gasLimit":"0x1c9c380","gasUsed":"0x1b90458","hash":"0xf512d3f0797b359b4c15eb2413f52719e5a38b93c2b80e3ab34a2631f7df31a7","logsBloom":"0x440005084900401020180433220c360801e880fb0627125022c285080f004dca20803408082012100a8002122104058301d04c0080004e94008250844d22094911600040130c018b6082400a8408d000045580a40304480454414f00484050526001000003420cc30020048090084862088846c0000505700214001d80093063c2f224000bb070406801c8256028622256850c10090027805011084a0503004032987050010550421b1b412401e9021c0082e0e1020f946210c020a200aa084101240d0a08010600115340a1eb02420a50c03e01100c8002a932c220054420220718842062ea0a8048a02c0378844b84001a022019004079060801030c605080","miner":"0x9b7e335088762ad8061c04d08c37902abc8acb87","mixHash":"0x5565968af09f9771fc81f012a47feab2f3882cbe326d2a2273080cde455b49db","nonce":"0x0000000000000000","number":"0x694a76","parentBeaconBlockRoot":"0xa16cf57486c242313759d81918031ac09a956202c9cf1a51b469fe40756b1090","parentHash":"0xfd0d3de35ba3731afbf905d98d8d7ec4f7afc95b1ecd70fb9b7e61f6a3f77471","receiptsRoot":"0xd3d4da3c5f911d465b2f94fadc836ddde34793035aea0e4906e5a3b1d5075207","requestsRoot":null,"sha3Uncles":"0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347","stateRoot":"0x908beacac85f4299926afebf80986faa6b6534f4544ab576a0198de4e509117e","timestamp":"0x6712cd94","transactionsRoot":"0x749f69851e83dceece5d2458d677b9384c61e389649d17da4e979d7fe0f5f206","withdrawalsRoot":"0x215d02cbdac540dca496927e8c9685bce60522098125aa3d5b67f935ee555854"
          // },"subscription":"0x07859641bba6dd7d21cdb79d704f679b"}}
          s.ws.send(
            `{"jsonrpc":"2.0","method":"eth_subscription","params":{"result":${JSON.stringify(
              result
            )},"subscription":"${s.id}"}}`
          );
        }
      }
    }
  }
}

async function runWithRetry(
  fn: (logger: Logger) => Promise<void>,
  timeout: number,
  logger: Logger
) {
  let retry = 0;
  while (true) {
    try {
      await fn(logger);
      retry = 0;
      await sleep(timeout);
    } catch (e) {
      retry++;
      logger.error(e);
      const expoBacko = timeout * 2 ** retry;
      logger.warn(`backing off for ${expoBacko}ms`);
      await sleep(expoBacko);
    }
  }
}

runWithRetry(getBlocks, SLEEP, logger.child({ source: "getBlocks" }));
runWithRetry(getLogs, SLEEP, logger.child({ source: "getLogs" }));
