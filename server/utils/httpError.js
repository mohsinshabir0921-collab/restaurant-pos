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

  console.error("[SERVER ERROR]", error.name, error.message);

  return res.status(500).json({ success: false, message: "Server error" });
};

module.exports = { handleError };
