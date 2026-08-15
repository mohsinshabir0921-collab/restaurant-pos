const { handleError } = require("../utils/httpError");

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  return handleError(res, err);
};

module.exports = { notFound, errorHandler };
