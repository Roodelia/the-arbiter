function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0;
}

module.exports = {
  isNonEmptyStringArray,
};
