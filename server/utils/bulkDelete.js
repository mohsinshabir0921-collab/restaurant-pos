const mongoose = require("mongoose");

// Validate a client-supplied array of record IDs. Returns the validated array
// of ObjectIds or throws. The client must NEVER be able to inject arbitrary
// query filters - only a plain array of object-id strings is accepted.
function parseIds(ids) {
  if (!Array.isArray(ids)) {
    const err = new Error("ids must be an array of record ids");
    err.status = 400;
    throw err;
  }
  if (ids.length === 0) {
    const err = new Error("ids array must not be empty");
    err.status = 400;
    throw err;
  }
  if (ids.length > 500) {
    const err = new Error("Too many ids in a single request (max 500)");
    err.status = 400;
    throw err;
  }
  const valid = [];
  for (const id of ids) {
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      const err = new Error(`Invalid record id: ${id}`);
      err.status = 400;
      throw err;
    }
    valid.push(new mongoose.Types.ObjectId(id));
  }
  return valid;
}

module.exports = { parseIds };
