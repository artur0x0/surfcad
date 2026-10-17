// db/models/LoginEvent.js — minimal login audit (TTL-managed)
import mongoose from 'mongoose';

/** @typedef {'password'|'verify'|'guest_convert'|'github'|'google'|'apple'} LoginMethod */

export const LOGIN_EVENT_TTL_SECONDS = 400 * 24 * 60 * 60;

const loginEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  at: {
    type: Date,
    required: true,
    default: () => new Date(),
  },
  method: {
    type: String,
    enum: ['password', 'verify', 'guest_convert', 'github', 'google', 'apple'],
    required: true,
  },
}, {
  collection: 'login_events',
  versionKey: false,
});

loginEventSchema.index({ at: 1 }, { expireAfterSeconds: LOGIN_EVENT_TTL_SECONDS });

const LoginEvent = mongoose.model('LoginEvent', loginEventSchema);

export default LoginEvent;
