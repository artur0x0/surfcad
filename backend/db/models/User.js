// db/models/User.js - User schema and model
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { defaultVaultName } from '../vaultNameDefaults.js';

const addressSchema = new mongoose.Schema({
  label: {
    type: String,
    default: 'Home',
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  street: {
    type: String,
    required: true,
    trim: true,
  },
  street2: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    required: true,
    trim: true,
  },
  state: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
  },
  zip: {
    type: String,
    required: true,
    trim: true,
  },
  country: {
    type: String,
    default: 'US',
    uppercase: true,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
}, { _id: true });

const cartOptionsSchema = new mongoose.Schema({
  process: { type: String, default: null },
  material: { type: String, default: null },
  infill: { type: Number, default: null },
}, { _id: false });

const cartLineSchema = new mongoose.Schema({
  lineId: { type: String, required: true },
  source: { type: String, enum: ['local', 'git'], required: true },
  assemblyName: { type: String, required: true },
  partId: { type: String, required: true },
  surfId: { type: String, default: null },
  partName: { type: String, required: true },
  // Hash of the script that was quoted. Not a live pointer. The script stays
  // on the assembly. Old lines still store whatever hash they were added with.
  scriptHash: { type: String, required: true },
  // Route strips data URLs over 24_000 characters before save.
  thumbDataUrl: { type: String, default: null, maxlength: 24000 },
  qty: { type: Number, required: true, min: 1, max: 999, default: 1 },
  // Null on lines added before a quote was locked. A v3 line stores the
  // process, material, and infill the user accepted.
  options: { type: cartOptionsSchema, default: null },
  // Server unit subtotal in dollars. Null means the line was never quoted.
  // A quote older than 7 days (QUOTE_TTL_MS) stays on the line; checkout
  // re-quotes it. This is not a Mongo TTL — the line is not deleted.
  quotedUnitPrice: { type: Number, default: null },
  quoteId: { type: String, default: null, maxlength: 128 },
  quotedAt: { type: Date, default: null },
  addedAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
}, { _id: false });

const cartTombstoneSchema = new mongoose.Schema({
  lineId: { type: String, required: true },
  deletedAt: { type: Date, required: true },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  passwordHash: {
    type: String,
    default: null, // null for OAuth users
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'apple', 'github'],
    default: 'local',
  },
  providerId: {
    type: String,
    default: null, // OAuth provider's user ID
  },
  // GitHub repo that holds this user's parts. New accounts get surfcad-vault.
  // The default is a function so init/hydrate of an existing document does
  // not invent the name: Mongo stays unset until resolution writes back the
  // repo it actually found. A string default would look like surfcad-vault
  // on every old user and could be saved on the next unrelated write.
  // There is no settings UI for this field.
  vaultName: {
    type: String,
    trim: true,
    maxlength: 100,
    default: defaultVaultName,
  },
  // GitHub numeric user id (string). Set on Sign in with GitHub / Connect upsert.
  githubId: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  },
  // Name fields - support both single name and first/last
  name: {
    type: String,
    trim: true,
  },
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  addresses: [addressSchema],
  
  // Account status
  emailVerified: {
    type: Boolean,
    default: false,
  },
  
  // Email verification
  verificationCode: {
    type: String,
    default: null,
  },
  verificationCodeExpires: {
    type: Date,
    default: null,
  },
  verificationAttempts: {
    type: Number,
    default: 0,
  },
  lastVerificationAttempt: {
    type: Date,
    default: null,
  },
  
  // Preferences
  preferences: {
    defaultProcess: {
      type: String,
      enum: ['FDM', 'SLA', 'SLS', 'MJF'],
      default: 'FDM',
    },
    defaultMaterial: {
      type: String,
      default: 'PLA',
    },
    marketingOptIn: {
      type: Boolean,
      default: false,
    },
  },

  // Live part references. Not the vault. Missing on old users; defaults apply
  // on the next read/save. Readers still use `user.cart || []`.
  cart: {
    type: [cartLineSchema],
    default: () => [],
  },
  cartVersion: {
    type: Number,
    default: 0,
  },
  cartTombstones: {
    type: [cartTombstoneSchema],
    default: () => [],
  },
}, {
  timestamps: true,
});

// Indexes
userSchema.index({ authProvider: 1, providerId: 1 });
userSchema.index({ verificationCode: 1, verificationCodeExpires: 1 });

// Virtual for full name (combines firstName/lastName or falls back to name)
userSchema.virtual('fullName').get(function() {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  if (this.firstName || this.lastName) {
    return this.firstName || this.lastName;
  }
  return this.name || null;
});

// Virtual for default address
userSchema.virtual('defaultAddress').get(function() {
  return this.addresses.find(addr => addr.isDefault) || this.addresses[0];
});

// Instance method: Set password
userSchema.methods.setPassword = async function(password) {
  const saltRounds = 12;
  this.passwordHash = await bcrypt.hash(password, saltRounds);
};

// Instance method: Verify password
userSchema.methods.verifyPassword = async function(password) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(password, this.passwordHash);
};

// Instance method: Generate verification code
userSchema.methods.generateVerificationCode = function() {
  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();
  
  // Hash the code for storage (optional but more secure)
  this.verificationCode = code; // Store plain for simplicity, or hash it
  
  // Code expires in 15 minutes
  this.verificationCodeExpires = new Date(Date.now() + 15 * 60 * 1000);
  
  // Reset attempts
  this.verificationAttempts = 0;
  
  return code;
};

// Instance method: Verify the code
userSchema.methods.verifyCode = function(code) {
  // Check if code exists and hasn't expired
  if (!this.verificationCode || !this.verificationCodeExpires) {
    return { valid: false, error: 'No verification code found. Please request a new one.' };
  }
  
  // Check expiration
  if (new Date() > this.verificationCodeExpires) {
    return { valid: false, error: 'Verification code has expired. Please request a new one.' };
  }
  
  // Check attempts (max 5)
  if (this.verificationAttempts >= 5) {
    return { valid: false, error: 'Too many attempts. Please request a new code.' };
  }
  
  // Increment attempts
  this.verificationAttempts += 1;
  this.lastVerificationAttempt = new Date();
  
  // Compare codes
  if (this.verificationCode !== code) {
    const remaining = 5 - this.verificationAttempts;
    return { 
      valid: false, 
      error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` 
    };
  }
  
  // Success - clear verification fields
  this.emailVerified = true;
  this.verificationCode = null;
  this.verificationCodeExpires = null;
  this.verificationAttempts = 0;
  
  return { valid: true };
};

// Instance method: Check if can resend code (rate limiting)
userSchema.methods.canResendCode = function() {
  if (!this.lastVerificationAttempt) return true;
  
  // Allow resend after 60 seconds
  const cooldown = 60 * 1000; // 1 minute
  const timeSinceLastAttempt = Date.now() - this.lastVerificationAttempt.getTime();
  
  if (timeSinceLastAttempt < cooldown) {
    const secondsRemaining = Math.ceil((cooldown - timeSinceLastAttempt) / 1000);
    return { allowed: false, secondsRemaining };
  }
  
  return { allowed: true };
};

// The address book is capped. Checkout used to append a duplicate on every
// order; dedupe updates the matching entry instead. Over the cap is a 400
// from the route, not a silent drop.
export const MAX_ADDRESSES = 10;

const ADDRESS_FIELDS = ['label', 'name', 'street', 'street2', 'city', 'state', 'zip', 'country', 'phone'];

export class AddressBookError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AddressBookError';
    this.statusCode = statusCode;
  }
}

function addressPart(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** Dedupe key. City and state are not part of it. */
function addressDedupeKey(address) {
  return `${addressPart(address?.street)}|${addressPart(address?.street2)}|${addressPart(address?.zip)}`;
}

function findAddressById(addresses, id) {
  if (id == null || id === '') return null;
  try {
    return addresses.id(id) || null;
  } catch {
    return null;
  }
}

function copyAddressFields(target, data) {
  for (const field of ADDRESS_FIELDS) {
    if (data[field] !== undefined) target[field] = data[field];
  }
}

function addressIdKey(addr) {
  if (addr?._id == null) return '';
  return String(addr._id);
}

/** Newest saved address. ObjectId order, not array position. */
function newestAddress(addresses) {
  let newest = addresses[0];
  let newestKey = addressIdKey(newest);
  for (let i = 1; i < addresses.length; i += 1) {
    const key = addressIdKey(addresses[i]);
    if (key > newestKey) {
      newest = addresses[i];
      newestKey = key;
    }
  }
  return newest;
}

// Instance method: Add or update address.
// An `_id` updates that entry (the picker). A missing or unknown id is not
// an append. Without `_id`, a case-insensitive (street, street2, zip) match
// updates that entry; otherwise the address is appended when the book is
// under the cap. The first address is the default.
userSchema.methods.upsertAddress = function(addressData, makeDefault = false) {
  if (!addressData || typeof addressData !== 'object' || Array.isArray(addressData)) {
    throw new AddressBookError('Address is required', 400);
  }

  let existing = null;
  const hasId = addressData._id != null && addressData._id !== '';
  if (hasId) {
    existing = findAddressById(this.addresses, addressData._id);
    if (!existing) throw new AddressBookError('Address not found', 404);
  } else {
    const key = addressDedupeKey(addressData);
    existing = this.addresses.find((addr) => addressDedupeKey(addr) === key) || null;
  }

  if (!existing && this.addresses.length >= MAX_ADDRESSES) {
    throw new AddressBookError(`At most ${MAX_ADDRESSES} addresses`, 400);
  }

  const shouldDefault = !!makeDefault || (!existing && this.addresses.length === 0);
  if (shouldDefault) {
    this.addresses.forEach((addr) => { addr.isDefault = false; });
  }

  if (!existing) {
    const created = { isDefault: shouldDefault };
    copyAddressFields(created, addressData);
    this.addresses.push(created);
    return this.addresses[this.addresses.length - 1];
  }

  copyAddressFields(existing, addressData);
  if (shouldDefault) existing.isDefault = true;
  return existing;
};

// Instance method: Remove one address. If it was the default, the newest
// remaining address (greatest `_id`) becomes the default.
userSchema.methods.deleteAddress = function(id) {
  const existing = findAddressById(this.addresses, id);
  if (!existing) throw new AddressBookError('Address not found', 404);
  const wasDefault = existing.isDefault === true;
  this.addresses.pull(existing._id);
  if (wasDefault && this.addresses.length > 0) {
    const newest = newestAddress(this.addresses);
    this.addresses.forEach((addr) => { addr.isDefault = false; });
    newest.isDefault = true;
  }
  return this.addresses;
};

// Static method: Find or create OAuth user
userSchema.statics.findOrCreateOAuth = async function(profile, provider) {
  const { id, emails, displayName, name } = profile;
  const email = emails?.[0]?.value;
  
  if (!email) {
    throw new Error('Email is required for OAuth signup');
  }
  
  // Try to find by provider ID first
  let user = await this.findOne({ authProvider: provider, providerId: id });

  // GitHub: also match on githubId (Connect / Sign-in upsert)
  if (!user && provider === 'github' && id) {
    user = await this.findOne({ githubId: String(id) });
  }
  
  if (user) {
    let dirty = false;
    if (provider === 'github' && !user.githubId) {
      user.githubId = String(id);
      dirty = true;
    }
    // Backfill names from GitHub / OAuth profile when missing.
    if (!user.firstName && name?.givenName) {
      user.firstName = name.givenName;
      dirty = true;
    }
    if (!user.lastName && name?.familyName) {
      user.lastName = name.familyName;
      dirty = true;
    }
    if (!user.name && displayName) {
      user.name = displayName;
      dirty = true;
    }
    if (dirty) await user.save();
    return { user, isNew: false };
  }
  
  // Check if email already exists with different provider
  user = await this.findOne({ email });
  
  if (user) {
    // Link accounts - update existing user with OAuth
    user.authProvider = provider;
    user.providerId = id;
    user.emailVerified = true; // OAuth emails are verified
    if (provider === 'github') {
      user.githubId = String(id);
    }
    if (!user.firstName && name?.givenName) {
      user.firstName = name.givenName;
    }
    if (!user.lastName && name?.familyName) {
      user.lastName = name.familyName;
    }
    if (!user.name && displayName) {
      user.name = displayName;
    }
    await user.save();
    return { user, isNew: false };
  }
  
  // Create new user
  user = new this({
    email,
    authProvider: provider,
    providerId: id,
    githubId: provider === 'github' ? String(id) : null,
    firstName: name?.givenName || displayName?.split(' ')[0],
    lastName: name?.familyName || displayName?.split(' ').slice(1).join(' '),
    name: displayName || (name ? `${name.givenName || ''} ${name.familyName || ''}`.trim() : null),
    emailVerified: true, // OAuth emails are verified
  });
  
  await user.save();
  return { user, isNew: true };
};

// Transform for JSON (hide sensitive fields)
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.verificationCode;
    delete ret.verificationCodeExpires;
    delete ret.verificationAttempts;
    delete ret.lastVerificationAttempt;
    delete ret.__v;
    delete ret.cart;
    delete ret.cartVersion;
    delete ret.cartTombstones;
    return ret;
  },
});

const User = mongoose.model('User', userSchema);

export default User;
