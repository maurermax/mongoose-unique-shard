'use strict';

var _ = require('lodash');
var async = require('async');
var hash = require('object-hash');
var util = require('util');

var uniqueSchema;
var UniqueModel;

function DocumentNotUniqueError(message) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
};

util.inherits(DocumentNotUniqueError, Error);

function getValues(doc, paths) {
  var final = [];
  _.forEach(paths, function(path) {
    final.push(doc.get(path));
  });
  return final;
}

function getExistingValues(doc, paths) {
  var final = [];
  _.forEach(paths, function(path) {
    var val;
    if (doc._uniqueShard && doc._uniqueShard.initVals) {
      val = doc._uniqueShard.initVals[path];
    }
    return final.push(val);
  });
  return final;
}

function isNot(val) {
  return !val;
}

function performActionForAll(indexes, doc, action, next) {
  return async.each(indexes, function(paths, cb) {
    var vals = getValues(doc, paths);
    var existingVals = getExistingValues(doc, paths);
    if (_.every(vals, isNot) && _.every(vals, isNot)) {
      return cb();
    }
    action(paths, vals, existingVals, cb);
  }, next);
}

function getHash(collectionName, paths, vals) {
  var queryObject = { collection: collectionName };
  _.times(paths.length, function(i) {
    queryObject['vals.' + paths[i]] = vals[i];
  });
  return hash(queryObject);
}

function checkUnique(paths, doc, next) {
  function performCheckUnique(paths, vals, existingVals, cb) {
    UniqueModel.findOne({ _id: getHash(doc.constructor.collection.name, paths, vals) }, function(err, uniqueDoc) {
      if (err) {
        return cb(err);
      }
      if (!uniqueDoc) {
        return cb(); // we have no lock so everything is fine
      }
      if (_.isEqual(uniqueDoc.refId, doc._id)) {
        return cb(); // we check the lock so this document will always be allowed to resave its own values
      }
      doc.constructor.collection.findOne({ _id: uniqueDoc.refId }, function(err, originalDoc) {
        if (err) {
          return cb(err);
        }
        if (!originalDoc) {
          return uniqueDoc.remove(cb);
        }
        return cb(new DocumentNotUniqueError('values ' + JSON.stringify(vals) + ' for paths ' + JSON.stringify(paths) + ' are not unique'));
      });
    });
  }

  performActionForAll(paths, doc, performCheckUnique, next);
}

function saveUnique(paths, doc, next) {
  function doSaveUnique(paths, vals, existingVals, cb) {
    var entry = new UniqueModel();
    entry._id = getHash(doc.constructor.collection.name, paths, vals);
    entry.refId = doc._id;
    entry.save(cb);
  }
  performActionForAll(paths, doc, doSaveUnique, next);
}

function removeExistingUnique(paths, doc, next) {
  function doRemoveUnique(paths, vals, existingVals, cb) {
    UniqueModel.remove({ _id: getHash(doc.constructor.collection.name, paths, existingVals)}, cb);
  }

  performActionForAll(paths, doc, doRemoveUnique, next);
}

function storeCurrentVals(paths, doc, next) {
  function storeValue(paths, vals, existingVals, cb) {
    if (!doc._uniqueShard) {
      Object.defineProperty(doc, '_uniqueShard', { enumerable: false, value: {} });
      doc._uniqueShard.initVals = {};
    }
    _.times(paths.length, function(i) {
      doc._uniqueShard.initVals[paths[i]] = vals[i];
    });
    return cb();
  }

  performActionForAll(paths, doc, storeValue, next);
}

function init(mongoose) {
  if (UniqueModel || uniqueSchema) {
    return;
  }
  var Schema = mongoose.Schema;
  uniqueSchema = new Schema({
    _id: { type: String, auto: false },
    refId: Schema.Types.Mixed
  }, {
    versionKey: false,
    autoIndex: false,
    shardKey: {
      _id: 'hashed'
    }
  });
  UniqueModel = mongoose.model('mongooseUniqueShard', uniqueSchema);
}

module.exports = function(schema, attrs) {
  if (!attrs.mongoose){
    throw new Error('please pass in a mongoose object in your attributes hash');
  }
  init(attrs.mongoose);
  var forgetCb = function() {
  };
  schema._uniqueShard = {};
  schema._uniqueShard.paths = getPaths('', schema);
  schema.addUniqueShardIndex = function(indexes) {
    if (_.isString(indexes)) {
      indexes = [indexes];
    };
    if (!_.isArray(indexes)) {
      throw new Error('can only add single path as string or array of strings as a path');
    }
    _.forEach(indexes, function(index) {
      if (!_.isString(index)) {
        throw new Error('can only add single path as string or array of strings as a path');
      }
    });
    schema._uniqueShard.paths.push(indexes);
  }
  schema.pre('init', function(next) {
    var doc = this;
    doc.on('init', function() {
      storeCurrentVals(doc.schema._uniqueShard.paths, doc, forgetCb);
    });
    next();
  });
  schema.pre('validate', function(next) {
    var doc = this;
    checkUnique(doc.schema._uniqueShard.paths, doc, next);
  });
  schema.pre('save', function(next) {
    var doc = this;
    async.waterfall([function(cb) {
      if (doc.isNew) {
        return cb();
      }
      removeExistingUnique(doc.schema._uniqueShard.paths, doc, cb);
    }, function(cb) {
      saveUnique(doc.schema._uniqueShard.paths, doc, cb);
    }], next);
  });
  schema.post('save', function() {
    var doc = this;
    storeCurrentVals(doc.schema._uniqueShard.paths, doc, forgetCb);
  });
  schema.post('remove', function() {
    var doc = this;
    removeExistingUnique(doc.schema._uniqueShard.paths, doc, forgetCb);
  });
};

module.exports.DocumentNotUniqueError = DocumentNotUniqueError;

function getPaths(parentPath, schema) {
  return _.reduce(schema.tree, function(memo, node, path) {
    var p = isUnique(parentPath, node, path);
    if (p) {
      memo.push.apply(memo, p);
    }
    return memo;
  }, []);
}

function isUnique(parentPath, node, path) {
  if (!node) {
    return [];
  }
  var completePath = path;
  if (parentPath) {
    completePath = parentPath + '.' + path;
  }
  // Array case
  if (node instanceof Array) {
    var f = _.first(node);
    // Nested Schema case
    if (f && f.tree) {
      return getPaths(f, {});
    } else {
      return isUnique(f, path);
    }
  } else if (_.isObject(node) && !node.type && !node.getters) { // object case
    var s = { tree: node };
    var o = getPaths(completePath, s);

    return _.isEmpty(o) ? [] : o;
  } else if (node.uniqueShardIndex) {
    return [[completePath]];
  }
}
