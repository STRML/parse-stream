'use strict';
require('flow-remove-types/register');
const ParseStream = require('../src/index');
const assert = require('assert');
const {Transform} = require('stream');

/*global describe:true, it:true*/
describe('ParseStream tests', function() {

  function getJSONStream() {
    const parseStream = new ParseStream({
      getDataGramLength(buf) {
        if (buf.length < 4) return Infinity;
        return 4 + buf.readUInt32LE(0);
      },
    });
    const JSONTransformStream = new Transform({
      transform(chunk, encoding, callback) {
        // Slice off first 4 which is length
        callback(null, JSON.parse(chunk.slice(4).toString('utf8')));
      },
      readableObjectMode: true,
    });
    // Also return original stream
    // Basically [readableTransform, writableTransform]
    return [parseStream.pipe(JSONTransformStream), parseStream];
  }

  function serializeBuf(obj) {
    const str = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + str.length);
    buf.writeUInt32LE(Buffer.byteLength(str), 0);
    buf.write(str, 4);
    return buf;
  }

  it('Deserializes a buffer correctly.', function(done) {
    const [readableStream] = getJSONStream();
    const testObject = generateObjectOfSize(1000);
    readableStream.on('data', function(data) {
      assert.deepEqual(data, testObject);
    });
    readableStream.on('end', done);
    readableStream.end(serializeBuf(testObject));
  });

  it('Deserializes a large, split buffer correctly.', function(done) {
    const [readableStream, writableStream] = getJSONStream();
    const largeObject = generateObjectOfSize(100000);

    // Add handlers
    readableStream.on('data', function(data) {
      assert.deepEqual(data, largeObject);
    });
    readableStream.on('end', done);

    const largeSerializedBuffer = serializeBuf(largeObject);

    // Write
    const step = 10000;
    let len = 0, next;
    while (len < largeSerializedBuffer.length) {
      next = len + step;
      if (next > largeSerializedBuffer.length) next = largeSerializedBuffer.length;
      writableStream.write(largeSerializedBuffer.slice(len, next));
      len = next;
    }
    writableStream.end();
  });

  it('Emits multiple data events through deserialize stream', function(done) {
    const [readableStream, writableStream] = getJSONStream();
    const obj = {foo: 'bar', baz: 'biff'};
    const dataBuf = serializeBuf(obj);

    const expectedCount = 10;
    let count = 0;
    const multiplyingStream = new Transform({
      transform: function (chunk, enc, callback) {
        for (let i = 0; i < expectedCount; i++) {
          this.push(chunk);
        }
        callback();
      }
    });
    multiplyingStream.pipe(writableStream);
    readableStream.on('data', (data) => {
      assert.deepEqual(data, obj);
      if (++count === expectedCount) done();
    });
    multiplyingStream.write(dataBuf);
  });

  it('Handles concatted chunks', function(done) {
    const COUNT = 500;
    const [readableStream, writableStream] = getJSONStream();

    const chunks = [];
    for (let i = 0; i < COUNT; i++) {
      chunks[i] = serializeBuf(generateObjectOfSize(128));
    }

    let seen = 0;
    readableStream.on('data', function() {
      seen++;
      if (seen > COUNT) throw new Error('Too many data events!');
      if (seen === COUNT) done();
    });
    writableStream.write(Buffer.concat(chunks));
  });

  // Former bug; if a chunk came in and the length was not yet readable (e.g. split on the very end of the datagram),
  // we would get an index out of range error
  it('Handles a message split before the length field', function(done) {
    const [readableStream, writableStream] = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);
    const buf1 = buf.slice(0, 3);
    const buf2 = buf.slice(3);

    readableStream.on('data', function(datum) {
      assert.deepEqual(datum, obj);
      done();
    });

    writableStream.write(buf1);
    writableStream.write(buf2);
  });

  it('Handles a message split before the length (byte by byte)', function(done) {
    const [readableStream, writableStream] = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);

    readableStream.on('data', function(datum) {
      assert.deepEqual(datum, obj);
      done();
    });

    for (let i = 0; i < buf.length; i++) {
      writableStream.write(buf.slice(i, i + 1));
    }
  });

  it('Pulling chunkLen from readable stream', function(done) {
    const [, writableStream] = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);

    // This will come off the writable stream, as the readable (writableStream)
    // turns the buffer into an object
    writableStream.on('data', function(datum) {
      assert.equal(datum.length, buf.length);
      done();
    });

    writableStream.write(buf);
  });

  it('Doesn\'t reorder len', function(done) {
    const [readableStream, writableStream] = getJSONStream();
    const objs = [];
    const bufs = [];
    for (let i = 0; i < 100; i++) {
      objs[i] = generateObjectOfSize(i * 10);
      bufs[i] = serializeBuf(objs[i]);
    }

    let idx = 0;
    let lastLen = 0;
    writableStream.on('data', function(datum) {
      lastLen = datum.length;
      assert.equal(lastLen, bufs[idx].length);
      idx++;
      if (idx === 100) done();
    });

    readableStream.on('data', function(datum) {
      assert.deepEqual(datum, objs[idx]);
    });


    for (const buf of bufs) {
      writableStream.write(buf);
    }
  });
});

// Generate a large object.
// Size is in bytes; e.g. an object with one key serializes to
// '{"a":"s"}' which is 9 bytes. Each subsequent key is 8 bytes
// due to the comma.
// Not really accurate because the keys get larger when the numbers go up but,
// it doesn't really matter for this test.
function generateObjectOfSize(size) {
  const obj = {};
  for (let i = 1; i < size; i += 8) {
    obj[i] = 's';
  }
  return obj;
}
