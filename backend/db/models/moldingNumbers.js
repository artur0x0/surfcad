// Shared number checks for the molding catalog. Prices may be zero.
// A zero clamp force or a zero shot size is not a machine.

export function positiveNumber(message) {
  return {
    type: Number,
    required: true,
    validate: {
      validator(value) {
        return Number.isFinite(value) && value > 0;
      },
      message,
    },
  };
}

export function nonNegativeNumber(message) {
  return {
    type: Number,
    required: true,
    validate: {
      validator(value) {
        return Number.isFinite(value) && value >= 0;
      },
      message,
    },
  };
}

export function percentNumber(message) {
  return {
    type: Number,
    required: true,
    validate: {
      validator(value) {
        return Number.isFinite(value) && value >= 0 && value <= 100;
      },
      message,
    },
  };
}
