var expect = require('chai').expect;
var mongoose = require('mongoose');
var mongooseUniqueShard = require('../index');
var testSchema = new mongoose.Schema({
  uniqueKey: { type: String, uniqueShard: true }
});
testSchema.plugin(mongooseUniqueShard);
var TestModel = mongoose.model('test', testSchema);

function initMongoose(done) {
  mongoose.connect('mongodb://localhost/mongooseUniqueShardTest');
  mongoose.connection.once('connected', done);
}

describe('mongoose-unique-shard', function() {
  var uniqueCollection;
  var testCollection;
  before(function(done) {
    initMongoose(function() {
      uniqueCollection = mongoose.connection.db.collection('mongooseuniqueshards');
      testCollection = mongoose.connection.db.collection('tests');
      done();
    });
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

  it('saving the two documents with a duplicate key will error as we want it to stay unique', function(done) {
    var testModel = new TestModel();
    testModel.uniqueKey = 'test';
    var testModelConflicting = new TestModel();
    testModelConflicting.uniqueKey = 'test';
    testModel.save(function(err) {
      expect(err).to.not.be.ok;
      testModelConflicting.save(function(err) {
        expect(err).to.be.ok;
        expect(err.message).to.equal('value test for path uniqueKey is not unique');
        done();
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
});