var expect = require('chai').expect;
var mongoose = require('mongoose');
var mongooseUniqueShard = require('../index');

function initMongoose(done) {
  mongoose.connect('mongodb://localhost/mongooseUniqueShardTest');
  mongoose.connection.once('connected', done);
}

var counter = 0;

describe('mongoose-unique-shard', function() {
  var uniqueCollection;
  var testCollection;
  var TestModel;
  var testSchema;
  before(function(done) {
    initMongoose(function() {
      uniqueCollection = mongoose.connection.db.collection('mongooseuniqueshards');
      testCollection = mongoose.connection.db.collection('tests');
      done();
    });
  });
  beforeEach(function() {
    testSchema = new mongoose.Schema({
      uniqueKey: { type: String, uniqueShardIndex: true },
      subdoc: {
        uniqueSubKey: { type: String, uniqueShardIndex: true }
      },
      combinedKey1: String,
      combinedKey2: { type: String }
    });
    testSchema.plugin(mongooseUniqueShard);
    testSchema.addUniqueShardIndex(['combinedKey1', 'combinedKey2']);
    counter++;
    TestModel = mongoose.model('test' + counter, testSchema, 'tests');
  });
  beforeEach(function(done) {
    TestModel.remove({}, function(err) {
      expect(err).to.not.be.ok;
      uniqueCollection.remove({}, function(err) {
        expect(err).to.not.be.ok;
        done();
      });
    });
  });
  it('creates an entry in the unique db in case a schema entry using this is created', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    testModel.save(done);
  });

  describe('saving the two documents with a duplicate key will error as we want it to stay unique', function() {
    it('one the main level', function(done) {
      var testModel = new TestModel();
      testModel.uniqueKey = 'test';
      var testModelConflicting = new TestModel();
      testModelConflicting.uniqueKey = 'test';
      testModel.save(function(err) {
        expect(err).to.not.be.ok;
        testModelConflicting.save(function(err) {
          expect(err).to.be.ok;
          expect(err.message).to.equal('values ["test"] for paths ["uniqueKey"] are not unique');
          done();
        });
      });
    });

    it('on a subdocument level', function(done) {
      var testModel = new TestModel();
      testModel.subdoc = { uniqueSubKey: 'test' };
      var testModelConflicting = new TestModel();
      testModelConflicting.subdoc = { uniqueSubKey: 'test' };
      testModel.save(function(err) {
        expect(err).to.not.be.ok;
        testModelConflicting.save(function(err) {
          expect(err).to.be.ok;
          expect(err.message).to.equal('values ["test"] for paths ["subdoc.uniqueSubKey"] are not unique');
          done();
        });
      });
    });

    it('with a multi key index', function(done) {
      var testModel = new TestModel();
      testModel.combinedKey1 = 'val1';
      testModel.combinedKey2 = 'val2';
      var testModelConflicting = new TestModel();
      testModelConflicting.combinedKey1 = 'val1';
      testModelConflicting.combinedKey2 = 'val2';
      testModel.save(function(err) {
        expect(err).to.not.be.ok;
        testModelConflicting.save(function(err) {
          expect(err).to.be.ok;
          expect(err.message).to.equal('values ["val1","val2"] for paths ["combinedKey1","combinedKey2"] are not unique');
          done();
        });
      });
    });
  });

  it('in case the original document is gone and an old anti-duplication entry still exists it is still possible to add a new entry', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    var testModelConflicting = new TestModel();
    testModelConflicting.uniqueKey = 'test';
    testModel.save(function(err) {
      expect(err).to.not.be.ok;
      testCollection.remove({ _id: testModel._id }, function(err) {
        expect(err).to.not.be.ok;
        testModelConflicting.save(function(err) {
          expect(err).to.not.be.ok;
          done();
        });
      });
    });
  });

  it('in case we remove the original document through mongoose the locking document will also be gone', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    testModel.save(function(err) {
      expect(err).to.not.be.ok;
      testModel.remove(function(err) {
        expect(err).to.not.be.ok;
        uniqueCollection.findOne({ '_id.vals.uniqueKey': 'test' }, function(err, doc) {
          expect(err).to.not.be.ok;
          expect(doc).to.not.be.ok;
          done();
        });
      });
    });
  });

  it('in case we change update the value of a loaded document the unique collection will contain the correct values', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    testModel.save(function(err) {
      expect(err).to.not.be.ok;
      TestModel.findById(testModel._id, function(err, doc) {
        expect(err).to.not.be.ok;
        doc.uniqueKey = 'testChanged';
        doc.save(function(err) {
          expect(err).to.not.be.ok;
          uniqueCollection.findOne({ '_id.vals.uniqueKey': 'test' }, function(err, doc) {
            expect(err).to.not.be.ok;
            expect(doc).to.not.be.ok;
            uniqueCollection.findOne({ '_id.vals.uniqueKey': 'testChanged' }, function(err, doc) {
              expect(err).to.not.be.ok;
              expect(doc).to.be.ok;
              done();
            });
          });
        });
      });
    });
  });

  it('in case we change save a document multiple times updating values in between the unique collection will contain the correct values', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    testModel.save(function(err) {
      expect(err).to.not.be.ok;
      testModel.uniqueKey = 'testChanged';
      testModel.save(function(err) {
        expect(err).to.not.be.ok;
        uniqueCollection.findOne({ '_id.vals.uniqueKey': 'test' }, function(err, doc) {
          expect(err).to.not.be.ok;
          expect(doc).to.not.be.ok;
          uniqueCollection.findOne({ '_id.vals.uniqueKey': 'testChanged' }, function(err, doc) {
            expect(err).to.not.be.ok;
            expect(doc).to.be.ok;
            done();
          });
        });
      });
    });
  });

  describe('addUniqueShardIndex', function() {
    it('is a functoin in the schema', function() {
      expect(testSchema.addUniqueShardIndex).to.be.a('function');
    });
    it('will burp if nothing is passed to it', function() {
      expect(testSchema.addUniqueShardIndex).to.throw(Error);
    });
    it('will burp if no string but an object is passed to it', function() {
      expect(function() { testSchema.addUniqueShardIndex({}) }).to.throw(Error);
    });
    it('will burp if no string but a number is passed to it', function() {
      expect(function() { testSchema.addUniqueShardIndex(1) }).to.throw(Error);
    });
    it('will burp if an array that does not consist of strings is passed to it', function() {
      expect(function() { testSchema.addUniqueShardIndex([1]) }).to.throw(Error);
    });
    it('will work out fine with a proper index string', function() {
      expect(function() { testSchema.addUniqueShardIndex('combinedKey1') }).to.not.throw(Error);
    });
    it('will work out fine with a proper index array', function() {
      expect(function() { testSchema.addUniqueShardIndex(['combinedKey1', 'combinedKey2']) }).to.not.throw(Error);
    });
  });
});