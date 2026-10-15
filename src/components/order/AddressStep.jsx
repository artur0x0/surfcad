// components/order/AddressStep.jsx - Shipping address form
import React, { useState } from 'react';
import { MapPin, Loader2, AlertCircle } from 'lucide-react';

// US States
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

const AddressStep = ({ initialAddress, onComplete, onError }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [formData, setFormData] = useState({
    name: initialAddress?.name || '',
    street: initialAddress?.street || '',
    street2: initialAddress?.street2 || '',
    city: initialAddress?.city || '',
    state: initialAddress?.state || '',
    zip: initialAddress?.zip || '',
    phone: initialAddress?.phone || '',
    country: 'US',
  });
  const [errors, setErrors] = useState({});

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.name.trim()) newErrors.name = 'Name is required';
    if (!formData.street.trim()) newErrors.street = 'Street address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state) newErrors.state = 'State is required';
    if (!formData.zip.trim()) newErrors.zip = 'ZIP code is required';
    else if (!/^\d{5}(-\d{4})?$/.test(formData.zip.trim())) {
      newErrors.zip = 'Invalid ZIP code format';
    }
    if (formData.phone && !/^[\d\s\-()]+$/.test(formData.phone)) {
      newErrors.phone = 'Invalid phone number';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Validate address with UPS (optional)
  const validateAddress = async () => {
    setIsValidating(true);
    setValidationResult(null);
    
    try {
      const response = await fetch('/api/shipping/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address: formData }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setValidationResult(data);
      }
    } catch (error) {
      console.warn('Address validation failed:', error);
    } finally {
      setIsValidating(false);
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsLoading(true);
    
    try {
      // Save address
      const response = await fetch('/api/auth/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          address: formData,
          makeDefault: true,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save address');
      }
      
      onComplete(formData);
    } catch (error) {
      onError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle input change
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  // Apply suggested address
  const applySuggestion = (suggestion) => {
    setFormData(prev => ({
      ...prev,
      street: suggestion.street || prev.street,
      city: suggestion.city || prev.city,
      state: suggestion.state || prev.state,
      zip: suggestion.zip || prev.zip,
    }));
    setValidationResult(null);
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Full Name *
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
            errors.name ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
          }`}
          placeholder="John Doe"
        />
        {errors.name && (
          <p className="text-red-400 text-xs mt-1">{errors.name}</p>
        )}
      </div>

      {/* Street Address */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Street Address *
        </label>
        <input
          type="text"
          value={formData.street}
          onChange={(e) => handleChange('street', e.target.value)}
          className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
            errors.street ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
          }`}
          placeholder="123 Main St"
        />
        {errors.street && (
          <p className="text-red-400 text-xs mt-1">{errors.street}</p>
        )}
      </div>

      {/* Street 2 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Apt, Suite, Unit (optional)
        </label>
        <input
          type="text"
          value={formData.street2}
          onChange={(e) => handleChange('street2', e.target.value)}
          className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Apt 4B"
        />
      </div>

      {/* City, State, ZIP */}
      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-3">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            City *
          </label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => handleChange('city', e.target.value)}
            className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
              errors.city ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
            }`}
            placeholder="City"
          />
          {errors.city && (
            <p className="text-red-400 text-xs mt-1">{errors.city}</p>
          )}
        </div>
        
        <div className="col-span-1">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            State *
          </label>
          <select
            value={formData.state}
            onChange={(e) => handleChange('state', e.target.value)}
            className={`w-full bg-gray-800/50 border rounded-xl py-3 px-2 text-white focus:outline-none transition-colors appearance-none ${
              errors.state ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
            }`}
          >
            <option value="">--</option>
            {US_STATES.map(state => (
              <option key={state.code} value={state.code}>
                {state.code}
              </option>
            ))}
          </select>
          {errors.state && (
            <p className="text-red-400 text-xs mt-1">{errors.state}</p>
          )}
        </div>
        
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            ZIP *
          </label>
          <input
            type="text"
            value={formData.zip}
            onChange={(e) => handleChange('zip', e.target.value)}
            onBlur={validateAddress}
            className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
              errors.zip ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
            }`}
            placeholder="12345"
            maxLength={10}
          />
          {errors.zip && (
            <p className="text-red-400 text-xs mt-1">{errors.zip}</p>
          )}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Phone (for delivery updates)
        </label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => handleChange('phone', e.target.value)}
          className={`w-full bg-gray-800/50 border rounded-xl py-3 px-4 text-white placeholder-gray-500 focus:outline-none transition-colors ${
            errors.phone ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
          }`}
          placeholder="(555) 123-4567"
        />
        {errors.phone && (
          <p className="text-red-400 text-xs mt-1">{errors.phone}</p>
        )}
      </div>

      {/* Address Validation Result */}
      {isValidating && (
        <div className="flex items-center gap-2 text-chrome-secondary text-sm">
          <Loader2 className="animate-spin" size={16} />
          Validating address...
        </div>
      )}
      
      {validationResult && !validationResult.valid && validationResult.suggestions?.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-yellow-400 text-sm font-medium">
                Did you mean?
              </p>
              {validationResult.suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="block text-sm text-gray-300 hover:text-white mt-2 text-left"
                >
                  {suggestion.street}, {suggestion.city}, {suggestion.state} {suggestion.zip}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Country Note */}
      <p className="text-gray-500 text-xs flex items-center gap-1">
        <MapPin size={12} />
        Currently shipping to US addresses only
      </p>

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-3 bg-gray-300 text-black rounded-xl font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
      >
        {isLoading ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            Saving...
          </>
        ) : (
          'Continue to Shipping'
        )}
      </button>
    </form>
  );
};

export default AddressStep;
