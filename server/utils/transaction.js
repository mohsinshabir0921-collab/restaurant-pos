const mongoose = require("mongoose");

const TRANSACTION_UNAVAILABLE_MESSAGE = "Deletion could not be completed because a database transaction is unavailable.";

function isTestNonTransactionalAllowed() {
  // Explicit opt-in for isolated unit-test mocks only. Production must never use this.
  // Set `global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS = true` or env var in test setup.
  if (global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS === true) return true;
  if (process.env.ALLOW_NON_TRANSACTIONAL_FOR_TESTS === "1") return true;
  return false;
}

async function startTransaction() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    const err = new Error(TRANSACTION_UNAVAILABLE_MESSAGE);
    err.statusCode = 500;
    err.status = 500;
    throw err;
  }
  try {
    const session = await mongoose.startSession();
    session.startTransaction();
    return session;
  } catch (e) {
    const err = new Error(TRANSACTION_UNAVAILABLE_MESSAGE);
    err.statusCode = 500;
    err.status = 500;
    err.cause = e;
    throw err;
  }
}

async function commitTransaction(session) {
  if (!session) return;
  await session.commitTransaction();
  session.endSession();
}

async function abortTransaction(session) {
  if (!session) return;
  try {
    await session.abortTransaction();
  } finally {
    session.endSession();
  }
}

// Runs fn(session) inside a transaction.
// For production, a transaction is mandatory – if it cannot be started, fn is NEVER executed
// and a 500 error is thrown.
// For isolated unit-test mocks, an explicit opt-in via global.__ALLOW_NON_TRANSACTIONAL_FOR_TESTS
// or env ALLOW_NON_TRANSACTIONAL_FOR_TESTS=1 allows a non-transactional fallback. Production
// never sets that flag, so it can never fallback.
async function withTransaction(fn, opts = {}) {
  const allowTestFallback = isTestNonTransactionalAllowed();
  let session = null;
  try {
    session = await startTransaction();
  } catch (e) {
    if (allowTestFallback) {
      console.warn("TRANSACTION TEST FALLBACK: executing without transaction (explicitly allowed for test mock)");
      return fn(null);
    }
    throw e;
  }
  try {
    const result = await fn(session);
    await commitTransaction(session);
    return result;
  } catch (err) {
    await abortTransaction(session);
    throw err;
  }
}

module.exports = { startTransaction, commitTransaction, abortTransaction, withTransaction, TRANSACTION_UNAVAILABLE_MESSAGE };
