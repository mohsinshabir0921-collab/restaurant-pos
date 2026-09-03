const formatValidationErrors = (error) => {
  const messages = Object.values(error.errors || {})
    .map((e) => e.message)
    .join("; ");
  return messages || "Validation failed";
};

const handleError = (res, error) => {
  if (!error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }

  if (error.name === "CastError") {
    return res.status(400).json({ success: false, message: "Invalid ID format" });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: formatValidationErrors(error),
    });
  }

  if (error.type === "entity.parse.failed" || error.status === 400) {
    return res.status(400).json({ success: false, message: "Invalid request payload" });
  }

  if (error.statusCode === 500 || error.status === 500) {
    // Preserve explicit transaction-unavailable and other 500 messages
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }

  if (error.statusCode && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600) {
    return res.status(error.statusCode).json({ success: false, message: error.message || "Server error" });
  }
  if (error.status && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
    return res.status(error.status).json({ success: false, message: error.message || "Server error" });
  }

  console.error("[SERVER ERROR]", error.name, error.message);

  return res.status(500).json({ success: false, message: "Server error" });
};

module.exports = { handleError };
