// db/models/PartnerLead.js — public partner interest form submissions
import mongoose from 'mongoose';

const partnerLeadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 320,
  },
  company: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  website: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  partnerType: {
    type: String,
    required: true,
    trim: true,
    maxlength: 64,
  },
  partnerTypeOther: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000,
  },
  ip: {
    type: String,
    trim: true,
    maxlength: 64,
  },
  userAgent: {
    type: String,
    trim: true,
    maxlength: 500,
  },
}, {
  timestamps: true,
  collection: 'partners',
});

partnerLeadSchema.index({ createdAt: -1 });
partnerLeadSchema.index({ email: 1, createdAt: -1 });

const PartnerLead = mongoose.model('PartnerLead', partnerLeadSchema);

export default PartnerLead;
