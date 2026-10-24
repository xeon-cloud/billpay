(function () {
  const BASE = '/api/v1';
  const S = window.BILLPAY_BOOT || {};
  const MONTH = () => {
    const q = new URLSearchParams(location.search).get('month');
    return q && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : (S.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
  };

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 && auth) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname);
      throw new Error('Требуется вход');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.detail) || res.statusText);
    return data;
  }

  window.BillPayApi = {
    request,
    async login(login, password) {
      if (!login || !password) throw new Error('Введите логин и пароль');
      return request('/auth/login', { method: 'POST', body: { login, password }, auth: false });
    },
    logout: () => request('/auth/logout', { method: 'POST', auth: false }),
    me: () => request('/auth/me'),

    getOccurrences: (month = MONTH()) => request('/payment-occurrences?month=' + month),
    setPaid: (id, paidAt) => request('/payment-occurrences/' + id, { method: 'PATCH', body: { is_paid: !!paidAt, paid_at: paidAt || null } }),
    getSummary: (month = MONTH()) => request('/payments/summary?month=' + month),

    getRecurringPayments: () => request('/recurring-payments'),
    updateRecurringPayment: (id, body) => request('/recurring-payments/' + id, { method: 'PATCH', body }),
    createRecurringPayment: (body) => request('/recurring-payments', { method: 'POST', body }),
    deleteRecurringPayment: (id) => request('/recurring-payments/' + id, { method: 'DELETE' }),

    getUsers: () => request('/users'),
    createUser: (body) => request('/users', { method: 'POST', body }),
    updateUser: (id, body) => request('/users/' + id, { method: 'PATCH', body }),
    deleteUser: (id) => request('/users/' + id, { method: 'DELETE' }),

    getMeta: (month = MONTH()) => request('/meta?month=' + month),
    month: MONTH
  };
})();
