# parse-stream

Parse streams of binary data of arbitrary lengths, handling broken/incomplete chunks.

This is useful when procesisng binary data that can be chunked in any way. For example, imagine we're handling some arbitrary IPC format we'll call "jsonIPC" through a `net.Socket`.

"jsonIPC" is a fake, simple data format that encodes the length of the JSON string as a 32-bit little-endian uint before the JSON string. By default, `net.Socket` may emit 8192 byte chunks. These chunks may contain multiple messages, may be smaller than 8192 bytes, or contain part of a larger message. To illustrate, they may look like this, with `|` indicating a break in chunks:

```
[len32, ...message], [len32, ...message], [len32, ...mes | sage], [len32, ...message]
```

By defining how to get the length of each message from a stream of binary data, `ParseStream` takes care of splitting chunks properly, dealing with:

* Chunks that contain multiple messages
* Chunks that contain partial messages (e.g. 8192 byte chunks, 1MB message)
* Chunks that don't contain enough data to even parse the length
  - Return `Infinity` from `getDataGramLength()` and a larger chunk will be passed back on the next invocation.


### Usage

```js
const ParseStream = require('../dist/index.js');

// Get a socket from somewhere
const sock = new require('stream').PassThrough();
// Pipe through a ParseStream.
sock.pipe(new ParseStream({
  // This defines the transformation from raw buffer data to any type.
  // The length of the buffer you are passed is defined by getDataGramLength().
  // arity: (Buffer) => any
  parseDataGram(buf) {
    // Slice off first 4 which is length
    return JSON.parse(buf.slice(4).toString('utf8'));
  },
  // This is used to slice up buffers. Knowing your data format, return the
  // length of the message you expect to parse.
  // IMPORTANT: You may get a buffer of *any length*! Use Infinity as a
  // sentinel value to tell ParseStream to get another chunk.
  getDataGramLength(buf) {
    if (buf.length < 4) return Infinity;
    return 4 + buf.readUInt32LE(0);
  },
  // Must be set to true if you return objects from parseDataGram.
  // If you return strings or Buffers, no need.
  readableObjectMode: true,
}))
.on('data', function(result/*: Object */) {
  console.log(result, typeof result);
});

const testData = JSON.stringify({foo: 'bar', biff: [1,2,3]});
const testBuf = Buffer.alloc(4 + testData.length);
testBuf.writeUInt32LE(Buffer.byteLength(testData), 0);
testBuf.write(testData, 4);

sock.write(testBuf);
// Logs: "{foo: 'bar', biff: [1,2,3]}, 'object'"

```
