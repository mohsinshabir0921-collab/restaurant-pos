// Central pagination validation. Guarantees page is a positive integer and
// limit is a positive integer capped at MAX_LIMIT, so callers never build
// negative/NaN/huge skip or limit values that could crash the query.
const MAX_LIMIT = 100;

const parsePagination = (query = {}, defaultLimit = 20) => {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LIMIT)
      : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
};

module.exports = { parsePagination, MAX_LIMIT };
