/** Pure helpers for Privacy choices dialog state (testable without JSX). */

export function privacyChoicesEffective(analyticsAllowed, gpcActive) {
  return gpcActive ? false : !!analyticsAllowed;
}

export function privacyChoicesAnalyticsAttr(analyticsAllowed, gpcActive) {
  return privacyChoicesEffective(analyticsAllowed, gpcActive) ? 'on' : 'off';
}
