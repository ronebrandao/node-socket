const http = require("http");
const crypto = require("crypto");
const static = require("node-static");
const file = new static.Server("./");

const server = http.createServer((req, res) => {
  req.addListener("end", () => file.serve(req, res)).resume();
});

server.on("upgrade", (req, socket) => {
  if (req.headers["upgrade"] !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request");
    return;
  }

  handshakeHeaders = handshake(req);

  // Write the response back to the client socket, being sure to append two
  // additional newlines so that the browser recognises the end of the response
  // header and doesn't continue to wait for more header data: socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');
  console.log(handshakeHeaders);
  socket.write(handshakeHeaders.join("\r\n") + "\r\n\r\n");

  socket.on("data", buffer => {
    const message = parseMessage(buffer);

    if (message) {
      console.log(message);

      socket.write(constructReply({ message: "Hello from the server" }));
    } else if (message == null) {
      console.log("WebSocket connection closed by Client!");
    }
  });
});

function generateAcceptValue(acceptKey) {
  return crypto
    .createHash("sha1")
    .update(acceptKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "binary")
    .digest("base64");
}

function handshake(req) {
  // Read the websocket key provided by the client: const acceptKey = req.headers['sec-websocket-key'];
  const acceptKey = req.headers["sec-websocket-key"];
  // Generate the response value to use in the response: const hash = generateAcceptValue(acceptKey);
  const hash = generateAcceptValue(acceptKey);
  // Write the HTTP response into an array of response lines: const responseHeaders = [ 'HTTP/1.1 101 Web Socket Protocol Handshake', 'Upgrade: WebSocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${hash}` ];
  const responseHeaders = [
    "HTTP/1.1 101 Web Socket Protocol Handshake",
    "Upgrade: WebSocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${hash}`
  ];

  const protocol = req.headers["sec-websocket-protocol"];

  const protocols = protocol ? [] : protocol.split(",").map(x => x.trim());

  if (protocols.includes("json")) {
    responseHeaders.push("Sec-WebSocket-Protocol: json");
  }

  return responseHeaders;
}

function parseMessage(buffer) {
  firstByte = buffer.readUInt8(0);
  isFinalFrame = Boolean((firstByte >>> 7) & 0x1);
  const [reserved1, reserved2, reserved3] = [
    Boolean((firstByte >>> 6) & 0x1),
    Boolean((firstByte >>> 5) & 0x1),
    Boolean((firstByte >>> 4) & 0x1)
  ];
  const opCode = firstByte & 0xf;

  if (opCode == 0x8) {
    //connection closed
    return null;
  }

  if (opCode != 0x1) {
    return;
  }

  const secondByte = buffer.readUInt8(1);
  const isMasked = (secondByte >>> 7) & 0x1;

  let { payloadLength, currentOffset } = getPayloadInfo(buffer);

  let data = getBufferData(buffer, isMasked, payloadLength, currentOffset);

  return JSON.parse(data.toString("utf8"));
}

function getPayloadInfo(buffer) {
  const secondByte = buffer.readUInt8(1);

  let currentOffset = 2;
  let payloadLength = secondByte & 0x7f;

  if (payloadLength > 125) {
    if (payloadLength == 126) {
      //get the next 2 bytes, since the byte number #1 only has
      //the exact payload length if it is less then 126.
      payloadLength = buffer.readUInt16BE(currentOffset);
      currentOffset += 2;
    } else {
      const leftPart = buffer.readUInt32BE(currentOffset);
      const rightPart = buffer.readUInt32BE((currentOffset += 4));
      // Honestly, if the frame length requires 64 bits, you're probably doing it wrong.
      // In Node.js you'll require the BigInt type, or a special library to handle this.
      throw new Error("Large payloads not currently implemented");
    }
  }

  return { payloadLength, currentOffset };
}

function getBufferData(buffer, isMasked, payloadLength, currentOffset) {
  const data = Buffer.alloc(payloadLength);

  if (isMasked) {
    let maskingKey = buffer.readUInt32BE(currentOffset);
    currentOffset += 4;

    for (let i = 0, j = 0; i < payloadLength; ++i, j = i % 4) {
      const shift = j == 3 ? 0 : (3 - j) << 3;
      const mask = (shift == 0 ? maskingKey : maskingKey >>> shift) & 0xff;

      const source = buffer.readUInt8(currentOffset++);

      data.writeUInt8(mask ^ source, i);
    }
  } else {
    buffer.copy(data, 0, payloadLength++);
  }

  return data;
}

function constructReply(data) {
  // Convert the data to JSON and copy it into a buffer
  const json = JSON.stringify(data);
  const jsonByteLength = Buffer.byteLength(json);
  // Note: we're not supporting > 65535 byte payloads at this stage
  const lengthByteCount = jsonByteLength < 126 ? 0 : 2;
  const payloadLength = lengthByteCount === 0 ? jsonByteLength : 126;
  const buffer = Buffer.alloc(2 + lengthByteCount + jsonByteLength);
  // Write out the first byte, using opcode `1` to indicate that the message
  // payload contains text data
  buffer.writeUInt8(0b10000001, 0);
  buffer.writeUInt8(payloadLength, 1);
  // Write the length of the JSON payload to the second byte
  let payloadOffset = 2;
  if (lengthByteCount > 0) {
    buffer.writeUInt16BE(jsonByteLength, 2);
    payloadOffset += lengthByteCount;
  }
  // Write the JSON data to the data buffer
  buffer.write(json, payloadOffset);
  return buffer;
}

const port = 3210;
server.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
