import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { X, User, Mail, Loader2, Phone } from 'lucide-react';
import { displayOrderLines } from '../utils/checkoutPage.js';
import { httpsOnlyHref } from '../utils/httpsOnlyHref.js';
import ModalFit from './ModalFit';

const AccountModal = ({ onClose, user, selectedTab = 'info' }) => {
  const [activeTab, setActiveTab] = useState(selectedTab);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    address: {
      name: '',
      street: '',
      street2: '',
      city: '',
      state: '',
      zip: '',
      country: 'US',
      phone: '',
    }
  });

  const { logout } = useAuth();

  useEffect(() => {
    if (activeTab === 'orders') {
      fetchOrders();
    }
    // Populate form with user data
    if (user) {
      setFormData(prev => ({
        ...prev,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
      }));
      
      if (user.addresses?.length > 0) {
        const defaultAddr = user.addresses.find(a => a.isDefault) || user.addresses[0];
        setFormData(prev => ({ ...prev, address: { ...defaultAddr } }));
      }
    }
  }, [activeTab, user]);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/orders', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch orders');
      const data = await response.json();
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to change password');
      }
      setFormData(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      setSuccessMessage('Password changed successfully');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateAddress = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/auth/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          address: formData.address,
          makeDefault: true,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update address');
      }
      setSuccessMessage('Address updated successfully');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      onClose();
    } catch (err) {
      setError('Failed to log out');
    }
  };

  // Get display name from user
  const getDisplayName = () => {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName || user.lastName) {
      return user.firstName || user.lastName;
    }
    return user.name || 'No name set';
  };

  return (
    <ModalFit cap="80vh" className="surface-scrim flex items-center justify-center z-50 px-4">
      <div className="modal-fit-panel surface-glass rounded-2xl shadow-2xl max-w-lg w-full flex flex-col border border-chrome-border/50">
        <div className="flex items-center justify-between p-5 border-b border-chrome-border/50">
          <h2 className="text-lg font-semibold text-white">Account</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-chrome-border/50 rounded-lg transition-colors">
            <X size={20} className="text-chrome-secondary" />
          </button>
        </div>

        <div className="flex border-b border-chrome-border/50">
          <button
            onClick={() => setActiveTab('info')}
            className={`flex-1 py-3 text-sm font-medium ${activeTab === 'info' ? 'text-white border-b-2 border-blue-500' : 'text-chrome-secondary'}`}
          >
            Info
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`flex-1 py-3 text-sm font-medium ${activeTab === 'orders' ? 'text-white border-b-2 border-blue-500' : 'text-chrome-secondary'}`}
          >
            Orders
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
              <button onClick={() => setError(null)} className="ml-2 underline text-xs">Dismiss</button>
            </div>
          )}
          
          {successMessage && (
            <div className="p-3 bg-green-900/30 border border-green-500/50 rounded-lg text-green-400 text-sm">
              {successMessage}
              <button onClick={() => setSuccessMessage(null)} className="ml-2 underline text-xs">Dismiss</button>
            </div>
          )}

          {activeTab === 'info' && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-gray-300">
                  <User size={16} />
                  <span>{getDisplayName()}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-300">
                  <Mail size={16} />
                  <span>{user.email}</span>
                </div>
                {user.authProvider !== 'local' && (
                  <div className="text-xs text-gray-500">
                    Signed in with {user.authProvider === 'google' ? 'Google'
                      : user.authProvider === 'apple' ? 'Apple'
                      : user.authProvider === 'github' ? 'GitHub'
                      : user.authProvider}
                  </div>
                )}
              </div>

              <button 
                onClick={handleLogout}
                className="w-full py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                Log Out
              </button>
              <div className="border-t border-chrome-border/50"></div>

              {user.authProvider === 'local' && (
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <h3 className="text-sm font-medium text-white">Change Password</h3>
                  
                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">Current Password</label>
                    <input
                      type="password"
                      placeholder="Current Password"
                      value={formData.currentPassword}
                      onChange={e => setFormData({ ...formData, currentPassword: e.target.value })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">New Password</label>
                    <input
                      type="password"
                      placeholder="New Password (min 8 characters)"
                      value={formData.newPassword}
                      onChange={e => setFormData({ ...formData, newPassword: e.target.value })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">Confirm New Password</label>
                    <input
                      type="password"
                      placeholder="Confirm New Password"
                      value={formData.confirmPassword}
                      onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>

                  <button type="submit" disabled={isLoading} className="w-full py-2 bg-blue-600 text-white rounded-xl disabled:opacity-50">
                    {isLoading ? 'Updating...' : 'Change Password'}
                  </button>
                </form>
              )}

              <form onSubmit={handleUpdateAddress} className="space-y-4">
                <h3 className="text-sm font-medium text-white">Default Address</h3>
                
                <div className="space-y-1">
                  <label className="text-xs text-chrome-secondary">Full Name</label>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={formData.address.name}
                    onChange={e => setFormData({ ...formData, address: { ...formData.address, name: e.target.value } })}
                    className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-chrome-secondary">Street Address</label>
                  <input
                    type="text"
                    placeholder="Street Address"
                    value={formData.address.street}
                    onChange={e => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })}
                    className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-chrome-secondary">Apartment, suite, etc. (optional)</label>
                  <input
                    type="text"
                    placeholder="Apartment, suite, etc."
                    value={formData.address.street2}
                    onChange={e => setFormData({ ...formData, address: { ...formData.address, street2: e.target.value } })}
                    className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">City</label>
                    <input
                      type="text"
                      placeholder="City"
                      value={formData.address.city}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">State / Province</label>
                    <input
                      type="text"
                      placeholder="State"
                      value={formData.address.state}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address, state: e.target.value } })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">ZIP / Postal Code</label>
                    <input
                      type="text"
                      placeholder="ZIP"
                      value={formData.address.zip}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address, zip: e.target.value } })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-chrome-secondary">Country</label>
                    <input
                      type="text"
                      placeholder="Country"
                      value={formData.address.country}
                      onChange={e => setFormData({ ...formData, address: { ...formData.address, country: e.target.value } })}
                      className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-chrome-secondary flex items-center gap-1">
                    <Phone size={14} />
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="Phone"
                    value={formData.address.phone}
                    onChange={e => setFormData({ ...formData, address: { ...formData.address, phone: e.target.value } })}
                    className="w-full bg-gray-800/50 border border-chrome-border rounded-xl py-2 px-3 text-white"
                  />
                </div>

                <button type="submit" disabled={isLoading} className="w-full py-2 bg-gray-200 text-black rounded-xl disabled:opacity-50">
                  {isLoading ? 'Updating...' : 'Update Address'}
                </button>
              </form>
            </>
          )}

          {activeTab === 'orders' && (
            <>
              {isLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="animate-spin" size={24} /></div>
              ) : orders.length === 0 ? (
                <div className="text-chrome-secondary text-center py-4">No orders yet</div>
              ) : (
                <div className="space-y-4">
                  {orders.map(order => {
                    const trackingHref = httpsOnlyHref(order.shipping?.['tracking-url']);
                    return (
                    <div key={order['order-number']} className="p-4 bg-gray-800/50 rounded-xl space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-white">{order['order-number']}</span>
                        <span className={`text-sm px-2.5 py-1 rounded-full ${
                          order.status === 'delivered' ? 'bg-green-900/40 text-green-400' :
                          order.status === 'shipped' ? 'bg-blue-900/40 text-blue-400' :
                          order.status === 'paid' ? 'bg-purple-900/40 text-purple-400' :
                          order.status === 'processing' ? 'bg-orange-900/40 text-orange-400' :
                          'bg-yellow-900/40 text-yellow-400'
                        }`}>
                          {order.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-sm text-chrome-secondary">Date: {new Date(order['created-at']).toLocaleDateString()}</div>
                      <div className="text-sm text-chrome-secondary">Total: ${Number(order.quote?.total || 0).toFixed(2)}</div>
                      {order.shipping && order.shipping['tracking-number'] && (
                        <div className="text-sm text-chrome-secondary">
                          Tracking: {trackingHref ? (
                            <a href={trackingHref} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                              {order.shipping['tracking-number']}
                            </a>
                          ) : order.shipping['tracking-number']}
                        </div>
                      )}
                      <div className="space-y-1" data-order-lines="">
                        {displayOrderLines(order).map((line, index) => (
                          <div key={line.lineId || `line-${index}`} className="text-sm text-chrome-secondary" data-order-line="">
                            <span data-order-line-name="">{line.partName}</span>
                            {' · '}
                            {line.process || '—'} | {line.material || '—'}
                            {line.infill != null && line.infill !== '' ? ` | ${line.infill}%` : ''}
                            {' | Qty '}{line.quantity}
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalFit>
  );
};

export default AccountModal;
