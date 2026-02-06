// ============= PESTASTIC - Contract Management System =============
// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAijywj5gsxQRDSIPkE_Q9EAMdACHng3_Y",
  authDomain: "pestaticdatabase.firebaseapp.com",
  databaseURL: "https://pestaticdatabase-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pestaticdatabase",
  storageBucket: "pestaticdatabase.firebasestorage.app",
  messagingSenderId: "930313053124",
  appId: "1:930313053124:web:66e6ce6c889dc747d77a91"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// ============= VALIDATION UTILITIES =============
const Validation = {
  sanitizeString(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, '').trim();
  },

  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  },

  isValidPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  },

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP'
    }).format(amount || 0);
  },

  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
};

// ============= AUTHENTICATION MODULE =============
const Auth = {
  currentUser: null,
  currentUserData: null,

  init() {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        this.currentUser = user;
        const userData = await DB.getUser(user.uid);
        
        if (!userData) {
          // New user - create record with pending status
          await DB.createUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL,
            role: 'user',
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          this.showPendingApproval();
        } else if (userData.status === 'pending') {
          this.currentUserData = userData;
          this.showPendingApproval();
        } else if (userData.status === 'denied') {
          UI.showToast('Your access has been denied. Please contact administrator.', 'error');
          this.signOut();
        } else {
          this.currentUserData = userData;
          this.showApp();
        }
      } else {
        this.currentUser = null;
        this.currentUserData = null;
        this.showLoginPage();
      }
    });
  },

  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (error) {
      console.error('Sign in error:', error);
      UI.showToast('Sign in failed: ' + error.message, 'error');
    }
  },

  async signOut() {
    try {
      await auth.signOut();
      this.currentUser = null;
      this.currentUserData = null;
      this.showLoginPage();
    } catch (error) {
      console.error('Sign out error:', error);
      UI.showToast('Sign out failed', 'error');
    }
  },

  showLoginPage() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('login-content').classList.remove('hidden');
    document.getElementById('pending-approval').classList.add('hidden');
  },

  showPendingApproval() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('login-content').classList.add('hidden');
    document.getElementById('pending-approval').classList.remove('hidden');
  },

  showApp() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    this.updateUserDisplay();
    this.updateAdminFeatures();
    UI.init();
  },

  updateUserDisplay() {
    const user = this.currentUserData;
    if (!user) return;

    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');

    if (user.photoURL) {
      avatarEl.innerHTML = `<img src="${user.photoURL}" alt="Avatar">`;
    } else {
      avatarEl.textContent = (user.displayName || 'U').charAt(0).toUpperCase();
    }

    nameEl.textContent = user.displayName || user.email;
    roleEl.textContent = user.role === 'admin' ? 'Administrator' : 'User';
  },

  updateAdminFeatures() {
    const role = this.currentUserData?.role;
    const isAdmin = role === 'admin' || role === 'super_admin';
    document.querySelectorAll('.admin-only').forEach(el => {
      el.classList.toggle('hidden', !isAdmin);
    });
  },

  isAdmin() {
    const role = this.currentUserData?.role;
    return role === 'admin' || role === 'super_admin';
  },

  getCurrentUserName() {
    return this.currentUserData?.displayName || this.currentUser?.email || 'System';
  }
};

// ============= DATABASE LAYER =============
const DB = {
  generateId() {
    return database.ref().push().key;
  },

  async generateCustomerNo() {
    try {
      const snapshot = await database.ref('config/lastCustomerNo').once('value');
      let lastNo = snapshot.val() || 0;
      const newNo = lastNo + 1;
      await database.ref('config/lastCustomerNo').set(newNo);
      return `PC-${String(newNo).padStart(5, '0')}`;
    } catch (error) {
      console.error('Error generating customer no:', error);
      return `PC-${Date.now().toString().slice(-5)}`;
    }
  },

  async getNextContractNumber(customerNo) {
    try {
      const snapshot = await database.ref('contracts').orderByChild('customerNo').equalTo(customerNo).once('value');
      const contracts = snapshot.val() || {};
      return Object.keys(contracts).length + 1;
    } catch (error) {
      console.error('Error getting contract number:', error);
      return 1;
    }
  },

  calculateEndDate(startDate, months) {
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + parseInt(months));
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  },

  generateTreatmentSchedule(contractId, customerNo, startDate, months, frequency, treatmentType, teamId = '', timeSlot = '') {
    const treatments = [];
    const start = new Date(startDate);
    const end = new Date(this.calculateEndDate(startDate, months));
    
    const frequencyDays = {
      'weekly': 7,
      'bi-weekly': 14,
      'monthly': 30,
      'bi-monthly': 60,
      'quarterly': 90,
      'semi-annually': 180,
      'annually': 365
    };

    const interval = frequencyDays[frequency] || 30;
    let currentDate = new Date(start);
    let treatmentNo = 1;

    while (currentDate <= end) {
      treatments.push({
        id: this.generateId(),
        contractId,
        customerNo,
        treatmentNo,
        dateScheduled: currentDate.toISOString().split('T')[0],
        timeSlot: timeSlot || '',
        dateTreated: null,
        treatmentType,
        teamId: teamId || '',
        technician: '',
        chemicalUsed: '',
        notes: '',
        status: 'Scheduled',
        statusReason: '',
        createdAt: new Date().toISOString()
      });

      treatmentNo++;
      currentDate.setDate(currentDate.getDate() + interval);
    }

    return treatments;
  },

  getTreatmentStatus(treatment) {
    if (treatment.status === 'Completed' || treatment.status === 'Cancelled') {
      return treatment.status;
    }
    const today = new Date().toISOString().split('T')[0];
    const scheduled = treatment.dateScheduled;
    if (scheduled < today) {
      return 'Lapsed';
    }
    return 'Scheduled';
  },

  // Sanitizer to remove undefined properties before sending to Firebase
  _cleanForFirebase(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) {
      return value.map(v => this._cleanForFirebase(v));
    }
    if (typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (v === undefined) {
          continue;
        }
        out[k] = this._cleanForFirebase(v);
      }
      return out;
    }
    return value;
  },

  // ===== USERS =====
  async getUser(uid) {
    try {
      const snapshot = await database.ref(`users/${uid}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting user:', error);
      return null;
    }
  },

  async createUser(user) {
    try {
      await database.ref(`users/${user.uid}`).set(user);
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },

  async getUsers() {
    try {
      const snapshot = await database.ref('users').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting users:', error);
      return [];
    }
  },

  async updateUserStatus(uid, status) {
    try {
      await database.ref(`users/${uid}/status`).set(status);
    } catch (error) {
      console.error('Error updating user status:', error);
      throw error;
    }
  },

  // ===== CLIENTS =====
  async getClients() {
    try {
      const snapshot = await database.ref('clients').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting clients:', error);
      return [];
    }
  },

  async getClientByCustomerNo(customerNo) {
    try {
      const snapshot = await database.ref('clients').orderByChild('customerNo').equalTo(customerNo).once('value');
      const data = snapshot.val();
      if (data) {
        return Object.values(data)[0];
      }
      return null;
    } catch (error) {
      console.error('Error getting client:', error);
      return null;
    }
  },

  async saveClient(client) {
    try {
      if (!client.id) {
        client.id = this.generateId();
      }
      client.updatedAt = new Date().toISOString();
      await database.ref(`clients/${client.id}`).set(client);
      return client;
    } catch (error) {
      console.error('Error saving client:', error);
      throw error;
    }
  },

  async deleteClient(customerNo) {
    try {
      const client = await this.getClientByCustomerNo(customerNo);
      if (client) {
        await database.ref(`clients/${client.id}`).remove();
      }
    } catch (error) {
      console.error('Error deleting client:', error);
      throw error;
    }
  },

  // ===== CONTRACTS =====
  async getContracts() {
    try {
      const snapshot = await database.ref('contracts').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting contracts:', error);
      return [];
    }
  },

  async getContractById(id) {
    try {
      const snapshot = await database.ref(`contracts/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting contract:', error);
      return null;
    }
  },

  async getContractsByCustomerNo(customerNo) {
    try {
      const snapshot = await database.ref('contracts').orderByChild('customerNo').equalTo(customerNo).once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting contracts:', error);
      return [];
    }
  },

  async saveContract(contract) {
    try {
      if (!contract.id) {
        contract.id = this.generateId();
      }
      contract.updatedAt = new Date().toISOString();
      await database.ref(`contracts/${contract.id}`).set(contract);
      return contract;
    } catch (error) {
      console.error('Error saving contract:', error);
      throw error;
    }
  },

  async getContractBalance(contractId) {
    try {
      const contract = await this.getContractById(contractId);
      if (!contract) return 0;
      
      const payments = await this.getPaymentsByContractId(contractId);
      const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      return (parseFloat(contract.totalAmount) || 0) - totalPaid;
    } catch (error) {
      console.error('Error getting contract balance:', error);
      return 0;
    }
  },

  // ===== TREATMENTS =====
  async getTreatments() {
    try {
      const snapshot = await database.ref('treatments').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting treatments:', error);
      return [];
    }
  },

  async getTreatmentById(id) {
    try {
      const snapshot = await database.ref(`treatments/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting treatment:', error);
      return null;
    }
  },

  async getTreatmentsByContractId(contractId) {
    try {
      const snapshot = await database.ref('treatments').orderByChild('contractId').equalTo(contractId).once('value');
      const data = snapshot.val() || {};
      return Object.values(data).sort((a, b) => a.treatmentNo - b.treatmentNo);
    } catch (error) {
      console.error('Error getting treatments:', error);
      return [];
    }
  },

  async saveTreatments(treatments) {
    try {
      const updates = {};
      for (const treatment of treatments) {
        updates[`treatments/${treatment.id}`] = treatment;
      }
      await database.ref().update(updates);
    } catch (error) {
      console.error('Error saving treatments:', error);
      throw error;
    }
  },

  async updateTreatment(treatment) {
    try {
      treatment.updatedAt = new Date().toISOString();
      await database.ref(`treatments/${treatment.id}`).set(treatment);
    } catch (error) {
      console.error('Error updating treatment:', error);
      throw error;
    }
  },

  async getScheduledTreatments() {
    try {
      const treatments = await this.getTreatments();
      const enrichedTreatments = [];
      
      for (const treatment of treatments) {
        const client = await this.getClientByCustomerNo(treatment.customerNo);
        enrichedTreatments.push({
          ...treatment,
          clientName: client?.clientName || 'Unknown',
          contactNumber: client?.contactNumber || ''
        });
      }
      
      return enrichedTreatments;
    } catch (error) {
      console.error('Error getting scheduled treatments:', error);
      return [];
    }
  },

  async getUntreatedTreatments() {
    try {
      const treatments = await this.getTreatments();
      const today = new Date().toISOString().split('T')[0];
      const untreated = [];
      
      for (const treatment of treatments) {
        if (treatment.status !== 'Completed' && treatment.status !== 'Cancelled' && treatment.dateScheduled < today) {
          const client = await this.getClientByCustomerNo(treatment.customerNo);
          const daysOverdue = Math.floor((new Date() - new Date(treatment.dateScheduled)) / (1000 * 60 * 60 * 24));
          untreated.push({
            ...treatment,
            clientName: client?.clientName || 'Unknown',
            contactNumber: client?.contactNumber || '',
            daysOverdue
          });
        }
      }
      
      return untreated.sort((a, b) => b.daysOverdue - a.daysOverdue);
    } catch (error) {
      console.error('Error getting untreated treatments:', error);
      return [];
    }
  },

  // ===== PAYMENTS =====
  async getPayments() {
    try {
      const snapshot = await database.ref('payments').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting payments:', error);
      return [];
    }
  },

  async getPaymentById(id) {
    try {
      const snapshot = await database.ref(`payments/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting payment:', error);
      return null;
    }
  },

  async getPaymentsByContractId(contractId) {
    try {
      const snapshot = await database.ref('payments').orderByChild('contractId').equalTo(contractId).once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting payments:', error);
      return [];
    }
  },

  async savePayment(payment) {
    try {
      if (!payment.id) {
        payment.id = this.generateId();
      }
      payment.createdAt = payment.createdAt || new Date().toISOString();
      payment.updatedAt = new Date().toISOString();
      await database.ref(`payments/${payment.id}`).set(payment);
      return payment;
    } catch (error) {
      console.error('Error saving payment:', error);
      throw error;
    }
  },

  async deletePayment(id) {
    try {
      await database.ref(`payments/${id}`).remove();
    } catch (error) {
      console.error('Error deleting payment:', error);
      throw error;
    }
  },

  // ===== COMPLAINTS =====
  async getComplaints() {
    try {
      const snapshot = await database.ref('complaints').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting complaints:', error);
      return [];
    }
  },

  async getComplaintById(id) {
    try {
      const snapshot = await database.ref(`complaints/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting complaint:', error);
      return null;
    }
  },

  async saveComplaint(complaint) {
    try {
      if (!complaint.id) {
        complaint.id = this.generateId();
      }
      complaint.updatedAt = new Date().toISOString();
      await database.ref(`complaints/${complaint.id}`).set(complaint);
      return complaint;
    } catch (error) {
      console.error('Error saving complaint:', error);
      throw error;
    }
  },

  async deleteComplaint(id) {
    try {
      await database.ref(`complaints/${id}`).remove();
    } catch (error) {
      console.error('Error deleting complaint:', error);
      throw error;
    }
  },

  // ===== INSPECTIONS =====
  async getInspections() {
    try {
      const snapshot = await database.ref('inspections').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting inspections:', error);
      return [];
    }
  },

  async getInspectionById(id) {
    try {
      const snapshot = await database.ref(`inspections/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting inspection:', error);
      return null;
    }
  },

  async saveInspection(inspection) {
    try {
      if (!inspection.id) {
        inspection.id = this.generateId();
      }
      inspection.updatedAt = new Date().toISOString();
      await database.ref(`inspections/${inspection.id}`).set(inspection);
      return inspection;
    } catch (error) {
      console.error('Error saving inspection:', error);
      throw error;
    }
  },

  // ===== TEAMS =====
  async getTeams() {
    try {
      const snapshot = await database.ref('teams').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting teams:', error);
      return [];
    }
  },

  async getTeamById(id) {
    try {
      const snapshot = await database.ref(`teams/${id}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting team:', error);
      return null;
    }
  },

  async saveTeam(team) {
    try {
      // Only allow admins to create/update teams
      if (!Auth.isAdmin()) {
        console.warn('saveTeam blocked: current user is not admin', team);
        throw new Error('Unauthorized: only admins can create or update teams');
      }

      // Basic validation: team must have a non-empty name
      if (!team || !String(team.name || '').trim()) {
        throw new Error('Invalid team payload: missing team name');
      }

      // Normalize members array to ensure no undefined fields
      const normalizedMembers = Array.isArray(team.members) ? team.members.map(m => {
        return {
          name: m?.name ? String(m.name) : '',
          role: m?.role ? String(m.role) : 'Technician'
        };
      }) : [];

      const now = new Date().toISOString();

      if (!team.id) {
        const newTeam = {
          id: this.generateId(),
          name: team.name || '',
          members: normalizedMembers,
          createdAt: now,
          updatedAt: now
        };
        const clean = this._cleanForFirebase(newTeam);
        if (!clean.createdAt) clean.createdAt = now;
        await database.ref(`teams/${newTeam.id}`).set(clean);
        return newTeam;
      } else {
        const snapshot = await database.ref(`teams/${team.id}`).once('value');
        const existingTeam = snapshot.val();
        const updatedTeam = {
          id: team.id,
          name: team.name || (existingTeam?.name || ''),
          members: normalizedMembers,
          createdAt: existingTeam?.createdAt || now,
          updatedAt: now
        };
        const clean = this._cleanForFirebase(updatedTeam);
        if (!clean.createdAt) clean.createdAt = now;
        await database.ref(`teams/${team.id}`).set(clean);
        return updatedTeam;
      }
    } catch (error) {
      console.error('Error saving team:', error);
      throw error;
    }
  },

  async deleteTeam(id) {
    try {
      if (!Auth.isAdmin()) {
        console.warn('deleteTeam blocked: current user is not admin', id);
        throw new Error('Unauthorized: only admins can delete teams');
      }
      await database.ref(`teams/${id}`).remove();
    } catch (error) {
      console.error('Error deleting team:', error);
      throw error;
    }
  },

  // ===== CONTRACT UPDATES (AUDIT LOG) =====
  async getContractUpdates() {
    try {
      const snapshot = await database.ref('contractUpdates').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting contract updates:', error);
      return [];
    }
  },

  async saveContractUpdate(update) {
    try {
      const id = this.generateId();
      update.id = id;
      update.dateUpdated = new Date().toISOString();
      update.updatedBy = Auth.getCurrentUserName();
      await database.ref(`contractUpdates/${id}`).set(update);
    } catch (error) {
      console.error('Error saving contract update:', error);
    }
  },

  async getContractsForRenewal() {
    try {
      const contracts = await this.getContracts();
      const today = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      
      const renewalContracts = [];
      for (const contract of contracts) {
        if (contract.status === 'renewed') continue;
        
        const endDate = new Date(contract.contractEndDate);
        if (endDate <= thirtyDaysFromNow) {
          const client = await this.getClientByCustomerNo(contract.customerNo);
          const renewal = await this.getRenewalByContractId(contract.id);
          renewalContracts.push({
            ...contract,
            clientName: client?.clientName || 'Unknown',
            renewalStatus: renewal?.renewalStatus || '',
            agentHandling: renewal?.agentHandling || '',
            communicationSource: renewal?.communicationSource || ''
          });
        }
      }
      return renewalContracts;
    } catch (error) {
      console.error('Error getting contracts for renewal:', error);
      return [];
    }
  }
};

// ============= UI LAYER =============
const UI = {
  currentTab: 'dashboard',
  currentContractId: null,
  currentClientCustomerNo: null,
  calendarDate: new Date(),
  calendarFilter: 'all',
  calendarTeamFilter: 'all',
  scheduleTeamFilter: 'all',
  generatedTreatments: [],
  teamMemberCount: 0,

  pagination: {
    clients: { page: 1, perPage: 10 },
    contracts: { page: 1, perPage: 10 },
    payments: { page: 1, perPage: 10 },
    updates: { page: 1, perPage: 10 },
    complaints: { page: 1, perPage: 10 },
    inspections: { page: 1, perPage: 10 }
  },

  init() {
    this.renderPestCheckboxes();
    this.renderInspectionPestCheckboxes();
    this.renderDashboard();
    // 🔴 REMOVED: this.initDefaultTeams(); - NO MORE AUTO-CREATION!
  },

  async loadTeamsToDropdown(selectId, includeEmpty = true) {
    try {
      const teams = await DB.getTeams();
      const select = document.getElementById(selectId);
      if (!select) return;
      
      if (!Array.isArray(teams) || teams.length === 0) {
        if (includeEmpty) {
          select.innerHTML = '<option value="">No teams configured</option>';
        } else {
          select.innerHTML = '';
        }
        return;
      }
      
      if (includeEmpty) {
        select.innerHTML = '<option value="">Select Team</option>';
      } else {
        select.innerHTML = '';
      }
      
      teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = team.name;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading teams to dropdown:', error);
    }
  },

  async loadTeamTabs(containerId, filterFunction, filterPrefix) {
    try {
      const teams = await DB.getTeams();
      const container = document.getElementById(containerId);
      if (!container) return;
      
      while (container.children.length > 1) {
        container.removeChild(container.lastChild);
      }

      if (!Array.isArray(teams) || teams.length === 0) {
        return;
      }
      
      teams.forEach(team => {
        const button = document.createElement('button');
        button.className = 'team-filter-tab';
        button.textContent = team.name;
        button.onclick = () => filterFunction(team.id, button);
        container.appendChild(button);
      });
    } catch (error) {
      console.error('Error loading team tabs:', error);
    }
  },

  showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
  },

  hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
  },

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      ${type === 'success' ? '✓' : type === 'error' ? '✗' : '⚠'}
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  },

  showConfirm(title, message, onConfirm) {
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-modal-message').textContent = message;
    const confirmBtn = document.getElementById('confirm-modal-action');
    confirmBtn.onclick = () => {
      this.closeConfirmModal();
      onConfirm();
    };
    document.getElementById('confirm-modal').classList.remove('hidden');
  },

  closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
  },

  switchTab(tab) {
    this.currentTab = tab;
    
    document.querySelectorAll('.nav-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('.page').forEach(page => {
      page.classList.add('hidden');
    });
    document.getElementById(`page-${tab}`).classList.remove('hidden');

    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');

    this.refreshCurrentPage();
  },

  refreshCurrentPage() {
    switch (this.currentTab) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'clients':
        this.renderClientsPage();
        break;
      case 'contracts':
        this.renderContractsPage();
        break;
      case 'contract':
        this.loadExistingClients();
        this.loadTeamsToDropdown('assigned-team', true);
        break;
      case 'payments':
        this.renderPaymentsPage();
        break;
      case 'calendar':
        this.loadTeamTabs('calendar-team-tabs', this.setCalendarTeamFilter.bind(this), 'calendar');
        this.renderCalendar();
        break;
      case 'schedule':
        this.loadTeamTabs('schedule-team-tabs', this.setScheduleTeamFilter.bind(this), 'schedule');
        this.renderScheduleReport();
        break;
      case 'renewal':
        this.renderRenewalReport();
        break;
      case 'complaints':
        this.renderComplaintsPage();
        break;
      case 'untreated':
        this.renderUntreatedReport();
        break;
      case 'inspections':
        this.renderInspectionsPage();
        break;
      case 'teams':
        this.renderTeamsPage();
        break;
      case 'updates':
        this.renderUpdatesReport();
        break;
      case 'users':
        this.renderUsersPage();
        break;
    }
  },

  renderPestCheckboxes() {
    const pests = ['Cockroaches', 'Ants', 'Termites', 'Rodents', 'Mosquitoes', 'Flies', 'Bed Bugs', 'Moths', 'Spiders', 'Others'];
    const container = document.getElementById('pest-checkboxes');
    if (container) {
      container.innerHTML = pests.map(pest => `
        <label class="checkbox-item">
          <input type="checkbox" name="pest" value="${pest}">
          ${pest}
        </label>
      `).join('');
    }
  },

  renderInspectionPestCheckboxes() {
    const pests = ['Cockroaches', 'Ants', 'Termites', 'Rodents', 'Mosquitoes', 'Flies', 'Bed Bugs', 'Moths', 'Spiders', 'Others'];
    const container = document.getElementById('inspection-pest-checkboxes');
    if (container) {
      container.innerHTML = pests.map(pest => `
        <label class="checkbox-item">
          <input type="checkbox" name="inspection-pest" value="${pest}">
          ${pest}
        </label>
      `).join('');
    }
  },

  // ===== DASHBOARD =====
  async renderDashboard() {
    this.showLoading();
    try {
      const [clients, contracts, treatments, payments, complaints] = await Promise.all([
        DB.getClients(),
        DB.getContracts(),
        DB.getTreatments(),
        DB.getPayments(),
        DB.getComplaints()
      ]);

      const today = new Date();
      const activeContracts = contracts.filter(c => c.status === 'active');
      const scheduledTreatments = treatments.filter(t => t.status === 'Scheduled');
      const completedTreatments = treatments.filter(t => t.status === 'Completed');
      const lapsedTreatments = treatments.filter(t => DB.getTreatmentStatus(t) === 'Lapsed');
      
      const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      const totalContractValue = contracts.reduce((sum, c) => sum + (parseFloat(c.totalAmount) || 0), 0);
      const totalCollectibles = totalContractValue - totalPaid;
      
      const openComplaints = complaints.filter(c => c.status !== 'Completed');

      document.getElementById('dashboard-timestamp').textContent = `Data as of: ${today.toLocaleString()}`;

      document.getElementById('dashboard-stats').innerHTML = `
        <div class="stat-card info" onclick="UI.switchTab('clients')">
          <div class="stat-header"><div class="stat-label">Total Clients</div></div>
          <div class="stat-value">${clients.length}</div>
        </div>
        <div class="stat-card success" onclick="UI.switchTab('contracts')">
          <div class="stat-header"><div class="stat-label">Active Contracts</div></div>
          <div class="stat-value success">${activeContracts.length}</div>
        </div>
        <div class="stat-card info" onclick="UI.switchTab('schedule')">
          <div class="stat-header"><div class="stat-label">Scheduled</div></div>
          <div class="stat-value">${scheduledTreatments.length}</div>
        </div>
        <div class="stat-card danger" onclick="UI.switchTab('untreated')">
          <div class="stat-header"><div class="stat-label">Lapsed</div></div>
          <div class="stat-value danger">${lapsedTreatments.length}</div>
        </div>
        <div class="stat-card warning" onclick="UI.switchTab('payments')">
          <div class="stat-header"><div class="stat-label">Collectibles</div></div>
          <div class="stat-value warning">${Validation.formatCurrency(totalCollectibles)}</div>
        </div>
        <div class="stat-card warning" onclick="UI.switchTab('complaints')">
          <div class="stat-header"><div class="stat-label">Open Complaints</div></div>
          <div class="stat-value warning">${openComplaints.length}</div>
        </div>
      `;

      const upcomingTreatments = treatments
        .filter(t => t.status === 'Scheduled' && t.dateScheduled >= today.toISOString().split('T')[0])
        .sort((a, b) => new Date(a.dateScheduled) - new Date(b.dateScheduled))
        .slice(0, 5);

      document.getElementById('dashboard-quick-views').innerHTML = `
        <div class="quick-view-card">
          <h3 class="quick-view-title">📅 Upcoming Treatments</h3>
          <ul class="quick-view-list">
            ${upcomingTreatments.length === 0 ? '<li class="quick-view-item text-muted">No upcoming treatments</li>' :
              upcomingTreatments.map(t => `
                <li class="quick-view-item">
                  <span>${t.customerNo}</span>
                  <span class="text-muted">${Validation.formatDate(t.dateScheduled)}</span>
                </li>
              `).join('')
            }
          </ul>
        </div>
        <div class="quick-view-card">
          <h3 class="quick-view-title">⚠️ Recent Complaints</h3>
          <ul class="quick-view-list">
            ${openComplaints.length === 0 ? '<li class="quick-view-item text-muted">No open complaints</li>' :
              openComplaints.slice(0, 5).map(c => `
                <li class="quick-view-item">
                  <span>${c.customerNo || 'Unknown'}</span>
                  <span class="badge badge-${c.priorityLevel === 'High' ? 'danger' : c.priorityLevel === 'Medium' ? 'warning' : 'info'}">${c.priorityLevel}</span>
                </li>
              `).join('')
            }
          </ul>
        </div>
      `;
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      this.showToast('Error loading dashboard', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== TEAMS =====
  async renderTeamsPage() {
    this.showLoading();
    try {
      const teams = await DB.getTeams();
      const container = document.getElementById('teams-container');

      if (teams.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No teams configured. Click "Add Team" to create your first team.</p></div>`;
      } else {
        container.innerHTML = teams.map(team => `
          <div class="team-card">
            <div class="team-card-header">
              <h3 class="team-card-title">${team.name}</h3>
              <div>
                <button class="btn btn-sm btn-outline" onclick="UI.editTeam('${team.id}')" title="Edit">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="UI.deleteTeam('${team.id}')" title="Delete">🗑️</button>
              </div>
            </div>
            <div class="team-members">
              ${(team.members || []).length === 0 
                ? '<p class="text-muted text-sm">No members assigned</p>'
                : (team.members || []).map(m => `
                    <div class="team-member">
                      <div class="flex items-center gap-2">
                        <div class="team-member-avatar">${(m.name || 'U').charAt(0)}</div>
                        <div>
                          <div class="team-member-name">${m.name}</div>
                          <div class="team-member-role">${m.role || 'Technician'}</div>
                        </div>
                      </div>
                    </div>
                  `).join('')
              }
            </div>
          </div>
        `).join('');
      }
    } catch (error) {
      console.error('Error rendering teams:', error);
      this.showToast('Error loading teams', 'error');
    } finally {
      this.hideLoading();
    }
  },

  openAddTeamModal() {
    document.getElementById('team-id').value = '';
    document.getElementById('team-modal-title').textContent = 'Add Team';
    document.getElementById('team-name').value = '';
    document.getElementById('team-members-container').innerHTML = '';
    this.teamMemberCount = 0;
    document.getElementById('team-modal').classList.remove('hidden');
  },

  async editTeam(teamId) {
    this.showLoading();
    try {
      const team = await DB.getTeamById(teamId);
      if (!team) {
        this.showToast('Team not found', 'error');
        return;
      }

      document.getElementById('team-id').value = teamId;
      document.getElementById('team-modal-title').textContent = 'Edit Team';
      document.getElementById('team-name').value = team.name || '';
      document.getElementById('team-members-container').innerHTML = '';
      this.teamMemberCount = 0;

      (team.members || []).forEach(m => this.addTeamMemberField(m));

      document.getElementById('team-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading team', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeTeamModal() {
    document.getElementById('team-modal').classList.add('hidden');
  },

  addTeamMemberField(memberData = null) {
    this.teamMemberCount++;
    const container = document.getElementById('team-members-container');
    const memberDiv = document.createElement('div');
    memberDiv.className = 'form-grid mb-4';
    memberDiv.innerHTML = `
      <div class="form-group">
        <label>Name</label>
        <input type="text" class="member-name" value="${memberData?.name || ''}">
      </div>
      <div class="form-group">
        <label>Role</label>
        <input type="text" class="member-role" value="${memberData?.role || 'Technician'}">
      </div>
      <div class="form-group" style="display: flex; align-items: flex-end;">
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.parentElement.remove()">Remove</button>
      </div>
    `;
    container.appendChild(memberDiv);
  },

  async saveTeam() {
    if (!Auth.isAdmin()) {
      this.showToast('Only administrators can create or edit teams', 'error');
      return;
    }

    const teamName = document.getElementById('team-name').value.trim();
    if (!teamName) {
      this.showToast('Please enter team name', 'error');
      return;
    }

    this.showLoading();
    try {
      const teamId = document.getElementById('team-id').value;
      const memberInputs = document.querySelectorAll('#team-members-container .form-grid');
      const members = [];

      memberInputs.forEach(div => {
        const name = (div.querySelector('.member-name')?.value || '').trim();
        const role = (div.querySelector('.member-role')?.value || '').trim();
        if (name) {
          members.push({ name, role: role || 'Technician' });
        }
      });

      const team = { name: teamName, members };
      if (teamId) team.id = teamId;

      await DB.saveTeam(team);

      this.closeTeamModal();
      this.showToast(teamId ? 'Team updated' : 'Team created');
      this.renderTeamsPage();
    } catch (error) {
      this.showToast('Error saving team: ' + error.message, 'error');
      console.error('Error saving team:', error);
    } finally {
      this.hideLoading();
    }
  },

  async deleteTeam(teamId) {
    this.showConfirm('Delete Team', 'Are you sure you want to delete this team?', async () => {
      this.showLoading();
      try {
        await DB.deleteTeam(teamId);
        this.showToast('Team deleted');
        this.renderTeamsPage();
      } catch (error) {
        this.showToast('Error deleting team', 'error');
      } finally {
        this.hideLoading();
      }
    });
  },

  // ===== OTHER METHODS TRUNCATED FOR BREVITY =====
  // (The rest of your UI methods stay exactly the same)
};

// ============= EVENT LISTENERS =============
document.addEventListener('DOMContentLoaded', () => {
  Auth.init();

  document.getElementById('google-login-btn')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
  });

  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  document.querySelectorAll('.nav-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) UI.switchTab(tab);
    });
  });

  // Additional event listeners stay the same...
});
