'use strict';
require('flow-remove-types/register');
const ParseStream = require('../src/index');
const assert = require('assert');
const {Transform} = require('stream');

/*global describe:true, it:true*/
describe('ParseStream tests', function() {

  function getJSONStream() {
    return new ParseStream({
      parseDataGram(buf) {
        // Slice off first 4 which is length
        return JSON.parse(buf.slice(4).toString('utf8'));
      },
      getDataGramLength(buf) {
        if (buf.length < 4) return Infinity;
        return 4 + buf.readUInt32LE(0);
      },
      readableObjectMode: true,
    });
  }

  function serializeBuf(obj) {
    const str = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + str.length);
    buf.writeUInt32LE(Buffer.byteLength(str), 0);
    buf.write(str, 4);
    return buf;
  }

  it('Deserializes a buffer correctly.', function(done) {
    const deserializeStream = getJSONStream();
    const testObject = generateObjectOfSize(1000);
    deserializeStream.on('data', function(data) {
      assert.deepEqual(data, testObject);
    });
    deserializeStream.on('end', done);
    deserializeStream.end(serializeBuf(testObject));
  });

  it('Deserializes a large, split buffer correctly.', function(done) {
    const deserializeStream = getJSONStream();
    const largeObject = generateObjectOfSize(100000);

    // Add handlers
    deserializeStream.on('data', function(data) {
      assert.deepEqual(data, largeObject);
    });
    deserializeStream.on('end', done);

    const largeSerializedBuffer = serializeBuf(largeObject);

    // Write
    const step = 10000;
    let len = 0, next;
    while (len < largeSerializedBuffer.length) {
      next = len + step;
      if (next > largeSerializedBuffer.length) next = largeSerializedBuffer.length;
      deserializeStream.write(largeSerializedBuffer.slice(len, next));
      len = next;
    }
    deserializeStream.end();
  });

  it('Emits multiple data events through deserialize stream', function(done) {
    const deserializeStream = getJSONStream();
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
    multiplyingStream.pipe(deserializeStream);
    deserializeStream.on('data', (data) => {
      assert.deepEqual(data, obj);
      if (++count === expectedCount) done();
    });
    multiplyingStream.write(dataBuf);
  });

  it('Handles concatted chunks', function(done) {
    const COUNT = 500;
    const deserializeStream = getJSONStream();

    const chunks = [];
    for (let i = 0; i < COUNT; i++) {
      chunks[i] = serializeBuf(generateObjectOfSize(128));
    }

    let seen = 0;
    deserializeStream.on('data', function() {
      seen++;
      if (seen > COUNT) throw new Error('Too many data events!');
      if (seen === COUNT) done();
    });
    deserializeStream.write(Buffer.concat(chunks));
  });

  // Former bug; if a chunk came in and the length was not yet readable (e.g. split on the very end of the datagram),
  // we would get an index out of range error
  it('Handles a message split before the length field', function(done) {
    const deserializeStream = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);
    const buf1 = buf.slice(0, 3);
    const buf2 = buf.slice(3);

    deserializeStream.on('data', function(datum) {
      assert.deepEqual(datum, obj);
      done();
    });

    deserializeStream.write(buf1);
    deserializeStream.write(buf2);
  });

  it('Handles a message split before the length (byte by byte)', function(done) {
    const deserializeStream = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);

    deserializeStream.on('data', function(datum) {
      assert.deepEqual(datum, obj);
      done();
    });

    for (let i = 0; i < buf.length; i++) {
      deserializeStream.write(buf.slice(i, i + 1));
    }
  });

  it('Emits "chunkLen" event', function(done) {
    const deserializeStream = getJSONStream();
    const obj = generateObjectOfSize(100);
    const buf = serializeBuf(obj);

    deserializeStream.on('chunkLen', function(len) {
      assert.equal(len, buf.length);
      done();
    });

    deserializeStream.write(buf);
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
