// components/TermsModal.jsx - Terms of Sale modal
import React from 'react';
import { X, FileText } from 'lucide-react';
import ModalFit from './ModalFit';

const TermsModal = ({ onClose, onAccept }) => {
  return (
    <ModalFit cap="85vh" className="surface-scrim flex items-center justify-center z-[60] px-4">
      <div className="modal-fit-panel surface-glass rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col border border-chrome-border/50">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-chrome-border/50">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-chrome-secondary" />
            <h2 className="text-lg font-semibold text-white">Terms of Sale</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-chrome-border/50 rounded-lg transition-colors"
          >
            <X size={20} className="text-chrome-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-gray-300">
          <p className="text-chrome-secondary text-xs">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>

          <p>
            By placing an order with SurfCAD ("we", "us", "our"), you ("Customer", "you") agree to the following terms and conditions. Please read them carefully before completing your purchase.
          </p>

          <section>
            <h3 className="text-white font-semibold mb-2">1. Order Acceptance</h3>
            <p>
              All orders are subject to acceptance at our sole discretion. We reserve the right to refuse or cancel any order for any reason, including but not limited to: design concerns, manufacturing feasibility, suspected fraudulent activity, or violation of these terms. If we cancel your order, you will receive a full refund.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">2. Design Responsibility</h3>
            <p>
              You are solely responsible for the design, specifications, and intended use of any parts you order. We manufacture parts according to the specifications you provide and do not review designs for engineering soundness, structural integrity, or fitness for any particular purpose. It is your responsibility to ensure your design is appropriate for your intended application.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">3. No Warranty of Fitness</h3>
            <p>
              <strong className="text-white">PARTS ARE PROVIDED "AS IS" WITHOUT ANY WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.</strong> We make no representations or warranties regarding the suitability, reliability, or accuracy of parts for any specific application. Any reliance on parts manufactured by us is at your own risk.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">4. Manufacturing Tolerances</h3>
            <p>
              3D printed parts are subject to manufacturing tolerances that vary by process:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-chrome-secondary">
              <li>FDM: ±0.3mm or ±0.3%, whichever is greater</li>
              <li>SLA: ±0.15mm or ±0.2%, whichever is greater</li>
              <li>SLS/MJF: ±0.3mm or ±0.3%, whichever is greater</li>
            </ul>
            <p className="mt-2">
              Parts may also exhibit process-specific characteristics including but not limited to: layer lines, support marks, surface texture variations, minor warping, and color variations between batches. These characteristics are inherent to additive manufacturing and do not constitute defects.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">5. Prohibited Applications</h3>
            <p>
              Parts manufactured by us are <strong className="text-white">NOT</strong> intended or approved for:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-chrome-secondary">
              <li>Use in any product or project subject to International Traffic in Arms Regulations (ITAR) rules</li>
              <li>Life-critical or life-support applications</li>
              <li>Medical devices or implants</li>
              <li>Aerospace or aviation components</li>
              <li>Automotive safety components</li>
              <li>Weapons or weapon components</li>
              <li>Food contact</li>
              <li>Applications where failure could result in injury, death, or property damage</li>
            </ul>
            <p className="mt-2">
              Use of our parts in any prohibited application is strictly at your own risk and we disclaim all liability for such use.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">6. Intellectual Property</h3>
            <p>
              By submitting a design for manufacturing, you represent and warrant that:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-chrome-secondary">
              <li>You own or have proper authorization to manufacture the design</li>
              <li>The design does not infringe any third-party intellectual property rights</li>
              <li>You will indemnify us against any IP infringement claims</li>
            </ul>
            <p className="mt-2">
              We do not claim ownership of your designs. However, we may retain design files for quality assurance and order fulfillment purposes.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">7. All Sales Final</h3>
            <p>
              <strong className="text-white">All sales are final. We do not offer refunds or accept returns</strong> except in the following circumstances:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-chrome-secondary">
              <li>Parts that do not match the submitted design specifications</li>
              <li>Parts with manufacturing defects that render them unusable</li>
              <li>Damaged or lost shipments (subject to carrier claim process)</li>
            </ul>
            <p className="mt-2">
              Refund requests must be submitted within 7 days of delivery with photographic evidence. Design errors, incorrect specifications, or dissatisfaction with inherent manufacturing characteristics do not qualify for refunds.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">8. Limitation of Liability</h3>
            <p>
              <strong className="text-white">TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM YOUR ORDER SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THAT ORDER.</strong>
            </p>
            <p className="mt-2">
              We shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to: loss of profits, loss of data, business interruption, personal injury, or property damage, regardless of the cause of action or whether we were advised of the possibility of such damages.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">9. Shipping & Delivery</h3>
            <p>
              Estimated delivery dates are not guaranteed. We are not liable for delays caused by carriers, customs, weather, or other factors outside our control. Risk of loss passes to you upon delivery to the carrier. Claims for damaged or lost shipments must be filed with the carrier within their specified timeframe.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">10. Force Majeure</h3>
            <p>
              We shall not be liable for any failure or delay in performing our obligations due to circumstances beyond our reasonable control, including but not limited to: natural disasters, acts of war, terrorism, pandemics, supply chain disruptions, or equipment failures.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">11. Age Requirement</h3>
            <p>
              You must be at least 18 years of age to place an order. By placing an order, you confirm that you are at least 18 years old.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">12. Governing Law</h3>
            <p>
              These terms shall be governed by and construed in accordance with the laws of the Commonwealth of Massachusetts, without regard to its conflict of law provisions. Any disputes shall be resolved in the courts of the Commonwealth of Massachusetts.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">13. Changes to Terms</h3>
            <p>
              We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting. Your continued use of our services constitutes acceptance of any modified terms.
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">14. Contact</h3>
            <p>
              If you have questions about these terms, please contact us at support@surfcad.com before placing your order.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-chrome-border/50 space-y-3">
          <button
            onClick={onAccept}
            className="w-full py-3 bg-gray-200 text-black rounded-xl font-medium hover:bg-white transition-colors"
          >
            I Accept These Terms
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-chrome-secondary text-sm hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalFit>
  );
};

export default TermsModal;
