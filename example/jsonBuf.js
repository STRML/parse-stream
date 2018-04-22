const ParseStream = require('../dist/index.js');

// Get a socket from somewhere
const sock = new require('stream').PassThrough();
// Pipe through a ParseStream.
sock.pipe(new ParseStream({
  // This defines the transformation from raw buffer data to an object (or any
  // type, really).
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
  // arity: (Buffer) => number
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
