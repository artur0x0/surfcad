import mongoose from 'mongoose';

const agentTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  label: {
    type: String,
    default: '',
  },
  machine: {
    type: String,
    default: '',
  },
  city: {
    type: String,
    default: null,
  },
  ip: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  revokedAt: {
    type: Date,
    default: null,
  },
  lastUsedAt: {
    type: Date,
    default: null,
  },
}, {
  collection: 'agentTokens',
  versionKey: false,
});

agentTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AgentToken = mongoose.models.AgentToken || mongoose.model('AgentToken', agentTokenSchema);

export default AgentToken;
