# mongoose-unique-shard
When sharding unique indexes are only allowed for keys matching the shard index. This module allows to still define other properties to be unique which will then be modelled using an additional collection to keep track of unique fields.

## How to use?

````
    var mongoose = require('mongoose');
    var Schema = mongoose.Schema;
    var mongooseUniqueShard = require('mongoose-unique-shard');
    var testSchema = new Schema({
      uniqueKey: { type: String, uniqueShardIndex: true },
      subdoc: {
        uniqueSubKey: { type: String, uniqueShardIndex: true }
      },
      combinedKey1: String,
      combinedKey2: { type: String }
    });
    testSchema.plugin(mongooseUniqueShard, { mongoose: mongoose }); // make sure that you pass your local mongoose to the plugin so that we create our collection in the correct database
    testSchema.addUniqueShardIndex(['combinedKey1', 'combinedKey2']);
    var TestModel = mongoose.model('test', testSchema);
    var tm1 = new TestModel();
    tm1.uniqueKey = 'foo';
    tm1.save(function() { // will work
        var tm2 = new TestModel();
        tm2.uniqueKey = 'foo';
        tm2.save(); // will fail as there is already a model holding this unique key in the database
    });

````

## How does this work?
As unique keys are not allowed in a sharded environment we have to use a separate collection to check for already existing unique key values. If you make use of this model an additional mongo collection will 'mongooseuniqueshards' will be created in your database holding the information used to do the unique checks.
 
When validating an object we check the collection whether it contains an object that would violate the uniqueness of the current object. In case such an object is present validation of the object will fail. Make sure that your objects are validated prior to saving them.

### What happens if I delete documents?

If you use the document.delete function we will cleanup old indexes for you. Since it might happen that the original document is deleted by other means we keep a back reference to the _id of the document and its collection with each lock. When a lock for a value pair for a certain document is found, we double check that this document does still exist. In case it has been deleted we will also clean up the lock object. 
*Beware:* So far we do not double check the values in the reread document. Make sure that you do not modify documents outside of this applications as the lock objects will not be updated.

## Bummers
- *Missing transactions could lead to inconsistencies:* Ay you will know Mongo has no transaction support. Inserting the document and inserting the blocker are two separate insertions. It might be that two documents both checked in parallel for the uniqueness object to be present. Both might see that it does not yet exist and then try to write this object. One write will fail as the uniqueness objects themselves have to be unique. 
- *Old indexes will be removed during the validaton process:* Updating the blocking indexes is done prior to saving the final document. If saving the final document fails for some reason the new blocking indexes will have already been presisted. This is no problem due to the double-check nature of the plugin, but if there have been any old unique blockers from an older version of the document it will have been deleted. In this case it might create an inconsistency allowing documents with duplicate keys to be created.
 
Because of the bummers you might want to have a batch job double checking your collection that it still ensures the uniqueness completely.

## I need more info/help. I found a bug.
Feel free to contact me or add an issue to the issue backlog on github.

## I want testing!
Run `npm test` to run the test suite. But make sure you have a mongo database running at `mongodb://localhost:27017`