const mongoose = require("mongoose");

function getMenuImagesBucket() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error("Database not connected");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "menuImages",
  });
}

function getHeroMediaBucket() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error("Database not connected");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "heroMedia",
  });
}

module.exports = { getMenuImagesBucket, getHeroMediaBucket };
