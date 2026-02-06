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
          // skip undefined properties
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

  // ===== FIXED DB.saveTeam: sanitize + always set timestamps =====
  async saveTeam(team) {
    try {
      // Normalize members array to ensure no undefined fields
      const normalizedMembers = Array.isArray(team.members) ? team.members.map(m => {
        return {
          name: m?.name ? String(m.name) : '',
          role: m?.role ? String(m.role) : 'Technician'
        };
      }) : [];

      // Ensure we always have a valid timestamp
      const now = new Date().toISOString();

      if (!team.id) {
        // New team - create complete object with guaranteed timestamps
        const newTeam = {
          id: this.generateId(),
          name: team.name || '',
          members: normalizedMembers,
          createdAt: now,
          updatedAt: now
        };

        // Clean object to remove any undefined values
        const clean = this._cleanForFirebase(newTeam);
        
        // Double-check that createdAt is present
        if (!clean.createdAt) {
          clean.createdAt = now;
        }
        
        await database.ref(`teams/${newTeam.id}`).set(clean);
        return newTeam;
      } else {
        // Existing team - fetch to preserve createdAt
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
        
        // Double-check that createdAt is present
        if (!clean.createdAt) {
          clean.createdAt = now;
        }
        
        await database.ref(`teams/${team.id}`).set(clean);
        return updatedTeam;
      }
    } catch (error) {
      console.error('Error saving team:', error);
      throw error;
    }
  }

  ,
  async deleteTeam(id) {
    try {
      await database.ref(`teams/${id}`).remove();
    } catch (error) {
      console.error('Error deleting team:', error);
      throw error;
    }
  },

  // ===== RENEWALS =====
  async getRenewals() {
    try {
      const snapshot = await database.ref('renewals').once('value');
      const data = snapshot.val() || {};
      return Object.values(data);
    } catch (error) {
      console.error('Error getting renewals:', error);
      return [];
    }
  },

  async getRenewalByContractId(contractId) {
    try {
      const snapshot = await database.ref('renewals').orderByChild('contractId').equalTo(contractId).once('value');
      const data = snapshot.val();
      if (data) {
        return Object.values(data)[0];
      }
      return null;
    } catch (error) {
      console.error('Error getting renewal:', error);
      return null;
    }
  },

  async saveRenewal(renewal) {
    try {
      if (!renewal.id) {
        renewal.id = this.generateId();
      }
      renewal.updatedAt = new Date().toISOString();
      await database.ref(`renewals/${renewal.id}`).set(renewal);
      return renewal;
    } catch (error) {
      console.error('Error saving renewal:', error);
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
    this.initDefaultTeams();
  },

  async initDefaultTeams() {
    // Teams should be created manually by admin users
    // No default teams will be auto-created
  },

  async loadTeamsToDropdown(selectId, includeEmpty = true) {
    try {
      const teams = await DB.getTeams();
      const select = document.getElementById(selectId);
      if (!select) return;
      
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
      
      // Keep the "All Teams" button
      const allButton = container.querySelector('.team-filter-tab.active') || 
                       container.querySelector('.team-filter-tab');
      
      // Clear all but first button
      while (container.children.length > 1) {
        container.removeChild(container.lastChild);
      }
      
      // Add team buttons
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
    
    // Update nav buttons
    document.querySelectorAll('.nav-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show/hide pages
    document.querySelectorAll('.page').forEach(page => {
      page.classList.add('hidden');
    });
    document.getElementById(`page-${tab}`).classList.remove('hidden');

    // Close mobile menu
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');

    // Render page content
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

      // Quick views - upcoming treatments
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

  // ===== CLIENTS PAGE =====
  async renderClientsPage() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('clients-search')?.value || '';
      let clients = await DB.getClients();

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        clients = clients.filter(c => 
          c.clientName?.toLowerCase().includes(term) ||
          c.customerNo?.toLowerCase().includes(term) ||
          c.contactNumber?.includes(term)
        );
      }

      clients = clients.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''));

      document.getElementById('clients-count').textContent = `${clients.length} clients`;
      const tbody = document.getElementById('clients-table-body');

      if (clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>No clients found</p></td></tr>`;
      } else {
        const enrichedClients = await Promise.all(clients.map(async c => {
          const contracts = await DB.getContractsByCustomerNo(c.customerNo);
          return { ...c, contractCount: contracts.length };
        }));

        tbody.innerHTML = enrichedClients.map(c => `
          <tr>
            <td>${c.customerNo}</td>
            <td>${c.clientName}</td>
            <td>${c.contactPerson || '-'}</td>
            <td>${c.contactNumber || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${c.salesAgent || '-'}</td>
            <td>${c.contractCount}</td>
            <td>${c.followUpCount || 0 >= 3 ? `<span class="badge badge-warning">${c.followUpCount || 0}</span>` : (c.followUpCount || 0)}</td>
            <td class="actions-cell">
              <button class="btn btn-sm btn-outline" onclick="UI.openClientEditModal('${c.customerNo}')" title="Edit">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="UI.deleteClient('${c.customerNo}')" title="Delete">🗑️</button>
            </td>
          </tr>
        `).join('');
      }
    } catch (error) {
      console.error('Error rendering clients:', error);
      this.showToast('Error loading clients', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async openClientEditModal(customerNo) {
    this.showLoading();
    try {
      const client = await DB.getClientByCustomerNo(customerNo);
      if (!client) {
        this.showToast('Client not found', 'error');
        return;
      }

      document.getElementById('edit-client-customer-no').value = customerNo;
      document.getElementById('edit-client-name').value = client.clientName || '';
      document.getElementById('edit-contact-person').value = client.contactPerson || '';
      document.getElementById('edit-contact-number').value = client.contactNumber || '';
      document.getElementById('edit-address').value = client.address || '';
      document.getElementById('edit-area-size').value = client.areaSize || '';
      document.getElementById('edit-email').value = client.email || '';
      document.getElementById('edit-sales-agent').value = client.salesAgent || '';

      document.getElementById('client-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading client', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeClientModal() {
    document.getElementById('client-modal').classList.add('hidden');
  },

  async saveClientEdit() {
    const customerNo = document.getElementById('edit-client-customer-no').value;
    const clientName = document.getElementById('edit-client-name').value.trim();
    const contactPerson = document.getElementById('edit-contact-person').value.trim();
    const contactNumber = document.getElementById('edit-contact-number').value.trim();
    const address = document.getElementById('edit-address').value.trim();

    if (!clientName || !contactPerson || !contactNumber || !address) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }

    this.showLoading();
    try {
      const client = await DB.getClientByCustomerNo(customerNo);
      if (!client) throw new Error('Client not found');

      const oldSalesAgent = client.salesAgent;
      const newSalesAgent = document.getElementById('edit-sales-agent').value;

      client.clientName = clientName;
      client.contactPerson = contactPerson;
      client.contactNumber = contactNumber;
      client.address = address;
      client.areaSize = document.getElementById('edit-area-size').value.trim();
      client.email = document.getElementById('edit-email').value.trim();
      client.salesAgent = newSalesAgent;

      await DB.saveClient(client);

      await DB.saveContractUpdate({
        customerNo,
        changeType: 'Client Updated',
        oldValue: `Name: ${client.clientName}`,
        newValue: `Updated client details`,
        reason: 'Manual edit'
      });

      this.closeClientModal();
      this.showToast('Client updated successfully');
      this.renderClientsPage();
    } catch (error) {
      this.showToast('Error saving client: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  },

  async deleteClient(customerNo) {
    this.showLoading();
    try {
      const contracts = await DB.getContractsByCustomerNo(customerNo);
      const activeContracts = contracts.filter(c => c.status === 'active');
      
      if (activeContracts.length > 0) {
        this.showToast('Cannot delete client with active contracts', 'error');
        return;
      }

      this.showConfirm('Delete Client', `Are you sure you want to delete this client (${customerNo})? This action cannot be undone.`, async () => {
        await DB.deleteClient(customerNo);
        this.showToast('Client deleted successfully');
        this.renderClientsPage();
      });
    } catch (error) {
      this.showToast('Error deleting client', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== CONTRACTS PAGE =====
  async renderContractsPage() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('contracts-search')?.value || '';
      const statusFilter = document.getElementById('contracts-status-filter')?.value || '';
      
      let contracts = await DB.getContracts();

      // Enrich with client names and balances
      const enrichedContracts = await Promise.all(contracts.map(async c => {
        const client = await DB.getClientByCustomerNo(c.customerNo);
        const balance = await DB.getContractBalance(c.id);
        return {
          ...c,
          clientName: client?.clientName || 'Unknown',
          balance
        };
      }));

      let filtered = enrichedContracts;

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(c => 
          c.customerNo?.toLowerCase().includes(term) ||
          c.clientName?.toLowerCase().includes(term)
        );
      }

      if (statusFilter) {
        filtered = filtered.filter(c => c.status === statusFilter);
      }

      filtered = filtered.sort((a, b) => new Date(b.contractStartDate) - new Date(a.contractStartDate));

      document.getElementById('contracts-count').textContent = `${filtered.length} contracts`;
      const tbody = document.getElementById('contracts-table-body');

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state"><p>No contracts found</p></td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(c => {
          const statusClass = c.status === 'active' ? 'badge-success' : c.status === 'expired' ? 'badge-danger' : 'badge-muted';
          return `
            <tr>
              <td>${c.customerNo}</td>
              <td>#${c.contractNumber || 1}</td>
              <td>${c.clientName}</td>
              <td>${Validation.formatDate(c.contractStartDate)}</td>
              <td>${Validation.formatDate(c.contractEndDate)}</td>
              <td>${Validation.formatCurrency(c.totalAmount)}</td>
              <td class="${c.balance > 0 ? 'text-warning' : ''}">${Validation.formatCurrency(c.balance)}</td>
              <td>${c.warrantyYears || 1}Y</td>
              <td><span class="badge ${statusClass}">${c.status}</span></td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="UI.viewContractDetail('${c.id}')" title="View">👁️</button>
                <button class="btn btn-sm btn-secondary" onclick="UI.openPaymentModalForContract('${c.id}')" title="Add Payment">💰</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering contracts:', error);
      this.showToast('Error loading contracts', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async viewContractDetail(contractId) {
    this.showLoading();
    try {
      const contract = await DB.getContract(contractId);
      if (!contract) {
        this.showToast('Contract not found', 'error');
        return;
      }

      const client = await DB.getClientByCustomerNo(contract.customerNo);
      const treatments = await DB.getTreatmentsByContract(contractId);
      const payments = await DB.getPaymentsByContract(contractId);

      // Calculate payment totals
      const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
      const balance = parseFloat(contract.totalAmount || 0) - totalPaid;

      // Generate HTML content
      const content = `
        <div class="contract-detail-grid">
          <!-- Client Information -->
          <div class="detail-section">
            <h4 class="detail-section-title">Client Information</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Customer No:</span>
                <span class="detail-value">${contract.customerNo}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Client Name:</span>
                <span class="detail-value">${client?.clientName || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Contact Person:</span>
                <span class="detail-value">${client?.contactPerson || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Contact Number:</span>
                <span class="detail-value">${client?.contactNumber || '-'}</span>
              </div>
              <div class="detail-item full-width">
                <span class="detail-label">Address:</span>
                <span class="detail-value">${client?.address || '-'}</span>
              </div>
            </div>
          </div>

          <!-- Contract Information -->
          <div class="detail-section">
            <h4 class="detail-section-title">Contract Information</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Contract No:</span>
                <span class="detail-value">#${contract.contractNumber}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Status:</span>
                <span class="badge badge-${contract.status}">${contract.status}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Treatment Method:</span>
                <span class="detail-value">${contract.treatmentMethod}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Frequency:</span>
                <span class="detail-value">${contract.treatmentFrequency}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Start Date:</span>
                <span class="detail-value">${Validation.formatDate(contract.contractStartDate)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">End Date:</span>
                <span class="detail-value">${Validation.formatDate(contract.contractEndDate)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Contract Length:</span>
                <span class="detail-value">${contract.contractLength} months</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Warranty:</span>
                <span class="detail-value">${contract.warrantyYears} year(s)</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Sales Agent:</span>
                <span class="detail-value">${contract.salesAgent || '-'}</span>
              </div>
            </div>
          </div>

          <!-- Financial Information -->
          <div class="detail-section">
            <h4 class="detail-section-title">Financial Information</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Total Amount:</span>
                <span class="detail-value text-bold">${Validation.formatCurrency(contract.totalAmount)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Downpayment:</span>
                <span class="detail-value">${Validation.formatCurrency(contract.downpaymentAmount)} (${contract.downpaymentPercent}%)</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Total Paid:</span>
                <span class="detail-value text-success">${Validation.formatCurrency(totalPaid)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Balance:</span>
                <span class="detail-value ${balance > 0 ? 'text-danger' : 'text-success'}">${Validation.formatCurrency(balance)}</span>
              </div>
            </div>
          </div>

          <!-- Treatments Schedule -->
          <div class="detail-section full-width">
            <h4 class="detail-section-title">Treatment Schedule (${treatments.length} treatments)</h4>
            <div class="table-container">
              <table class="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Treatment Type</th>
                    <th>Status</th>
                    <th>Team</th>
                    <th>Time Slot</th>
                  </tr>
                </thead>
                <tbody>
                  ${treatments.length === 0 ? 
                    '<tr><td colspan="6" class="text-center text-muted">No treatments scheduled</td></tr>' :
                    treatments.map((t, idx) => `
                      <tr>
                        <td>${idx + 1}</td>
                        <td>${Validation.formatDate(t.treatmentDate)}</td>
                        <td>${t.treatmentType}</td>
                        <td><span class="badge badge-${t.status}">${t.status}</span></td>
                        <td>${t.teamName || '-'}</td>
                        <td>${t.timeSlot || '-'}</td>
                      </tr>
                    `).join('')
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Payment History -->
          <div class="detail-section full-width">
            <h4 class="detail-section-title">Payment History (${payments.length} payments)</h4>
            <div class="table-container">
              <table class="table">
                <thead>
                  <tr>
                    <th>OR Number</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Type</th>
                    <th>Received By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${payments.length === 0 ? 
                    '<tr><td colspan="6" class="text-center text-muted">No payments recorded</td></tr>' :
                    payments.map(p => `
                      <tr>
                        <td>${p.orNumber}</td>
                        <td>${Validation.formatDate(p.paymentDate)}</td>
                        <td class="text-bold">${Validation.formatCurrency(p.amount)}</td>
                        <td>${p.paymentType}</td>
                        <td>${p.receivedBy}</td>
                        <td><span class="badge badge-${p.status}">${p.status}</span></td>
                      </tr>
                    `).join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      document.getElementById('contract-detail-content').innerHTML = content;
      document.getElementById('contract-detail-modal').classList.remove('hidden');
    } catch (error) {
      console.error('Error loading contract details:', error);
      this.showToast('Error loading contract details', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeContractDetailModal() {
    document.getElementById('contract-detail-modal').classList.add('hidden');
  },

  // ===== PAYMENTS PAGE =====
  async renderPaymentsPage() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('payments-search')?.value || '';
      const statusFilter = document.getElementById('payments-status-filter')?.value || '';

      let payments = await DB.getPayments();

      // Enrich with client info
      const enrichedPayments = await Promise.all(payments.map(async p => {
        const client = await DB.getClientByCustomerNo(p.customerNo);
        return {
          ...p,
          clientName: client?.clientName || 'Unknown'
        };
      }));

      let filtered = enrichedPayments;

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(p => 
          p.customerNo?.toLowerCase().includes(term) ||
          p.orNumber?.toLowerCase().includes(term) ||
          p.clientName?.toLowerCase().includes(term)
        );
      }

      if (statusFilter) {
        filtered = filtered.filter(p => p.status === statusFilter);
      }

      filtered = filtered.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

      document.getElementById('payments-count').textContent = `${filtered.length} payments`;
      const tbody = document.getElementById('payments-table-body');

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>No payments found</p></td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(p => {
          const statusClass = p.status === 'Deposited' ? 'badge-success' : p.status === 'Remitted' ? 'badge-info' : 'badge-warning';
          return `
            <tr>
              <td>${p.orNumber || '-'}</td>
              <td>${p.clientName}</td>
              <td>${Validation.formatCurrency(p.amount)}</td>
              <td>${Validation.formatDate(p.paymentDate)}</td>
              <td>${p.paymentType || '-'}</td>
              <td>${p.serviceRendered || '-'}</td>
              <td><span class="badge ${statusClass}">${p.status}</span></td>
              <td>${p.receivedBy || '-'}</td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="UI.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="UI.deletePayment('${p.id}')" title="Delete">🗑️</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering payments:', error);
      this.showToast('Error loading payments', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async openPaymentModalForContract(contractId) {
    this.showLoading();
    try {
      const contract = await DB.getContractById(contractId);
      if (!contract) {
        this.showToast('Contract not found', 'error');
        return;
      }

      const client = await DB.getClientByCustomerNo(contract.customerNo);
      const balance = await DB.getContractBalance(contractId);

      document.getElementById('payment-id').value = '';
      document.getElementById('payment-contract-id').value = contractId;
      document.getElementById('payment-customer-no').value = contract.customerNo;
      document.getElementById('payment-customer-display').textContent = client?.clientName || contract.customerNo;
      document.getElementById('payment-outstanding').textContent = Validation.formatCurrency(balance);
      
      // Reset form
      document.getElementById('payment-or-number').value = '';
      document.getElementById('payment-amount').value = '';
      document.getElementById('payment-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('payment-type').value = '';
      document.getElementById('payment-status').value = 'Received';
      document.getElementById('payment-received-by').value = '';
      document.getElementById('payment-service').value = '';
      document.getElementById('payment-notes').value = '';

      document.getElementById('payment-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading payment form', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async editPayment(paymentId) {
    this.showLoading();
    try {
      const payment = await DB.getPaymentById(paymentId);
      if (!payment) {
        this.showToast('Payment not found', 'error');
        return;
      }

      const client = await DB.getClientByCustomerNo(payment.customerNo);

      document.getElementById('payment-id').value = paymentId;
      document.getElementById('payment-contract-id').value = payment.contractId || '';
      document.getElementById('payment-customer-no').value = payment.customerNo;
      document.getElementById('payment-customer-display').textContent = client?.clientName || payment.customerNo;
      document.getElementById('payment-outstanding').textContent = '-';
      
      document.getElementById('payment-or-number').value = payment.orNumber || '';
      document.getElementById('payment-amount').value = payment.amount || '';
      document.getElementById('payment-date').value = payment.paymentDate || '';
      document.getElementById('payment-type').value = payment.paymentType || '';
      document.getElementById('payment-status').value = payment.status || 'Received';
      document.getElementById('payment-received-by').value = payment.receivedBy || '';
      document.getElementById('payment-service').value = payment.serviceRendered || '';
      document.getElementById('payment-notes').value = payment.notes || '';

      document.getElementById('payment-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading payment', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
  },

  async savePayment() {
    const orNumber = document.getElementById('payment-or-number').value.trim();
    const amount = parseFloat(document.getElementById('payment-amount').value);
    const paymentDate = document.getElementById('payment-date').value;
    const paymentType = document.getElementById('payment-type').value;
    const status = document.getElementById('payment-status').value;
    const receivedBy = document.getElementById('payment-received-by').value;
    const serviceRendered = document.getElementById('payment-service').value;

    if (!orNumber || !amount || !paymentDate || !paymentType || !receivedBy || !serviceRendered) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }

    this.showLoading();
    try {
      const paymentId = document.getElementById('payment-id').value;
      const contractId = document.getElementById('payment-contract-id').value;
      const customerNo = document.getElementById('payment-customer-no').value;

      const payment = {
        id: paymentId || null,
        contractId,
        customerNo,
        orNumber,
        amount,
        paymentDate,
        paymentType,
        status,
        receivedBy,
        serviceRendered,
        notes: document.getElementById('payment-notes').value.trim()
      };

      await DB.savePayment(payment);

      await DB.saveContractUpdate({
        customerNo,
        changeType: paymentId ? 'Payment Updated' : 'Payment Recorded',
        oldValue: '-',
        newValue: `${Validation.formatCurrency(amount)} - OR#${orNumber}`,
        reason: serviceRendered
      });

      this.closePaymentModal();
      this.showToast(paymentId ? 'Payment updated' : 'Payment recorded successfully');
      this.renderPaymentsPage();
    } catch (error) {
      this.showToast('Error saving payment: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  },

  async deletePayment(paymentId) {
    this.showConfirm('Delete Payment', 'Are you sure you want to delete this payment?', async () => {
      this.showLoading();
      try {
        const payment = await DB.getPaymentById(paymentId);
        await DB.deletePayment(paymentId);
        
        if (payment) {
          await DB.saveContractUpdate({
            customerNo: payment.customerNo,
            changeType: 'Payment Deleted',
            oldValue: `${Validation.formatCurrency(payment.amount)} - OR#${payment.orNumber}`,
            newValue: '-',
            reason: 'Manual deletion'
          });
        }
        
        this.showToast('Payment deleted');
        this.renderPaymentsPage();
      } catch (error) {
        this.showToast('Error deleting payment', 'error');
      } finally {
        this.hideLoading();
      }
    });
  },

  // ===== SCHEDULE PAGE =====
  async renderScheduleReport() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('schedule-search')?.value || '';
      const dateFilter = document.getElementById('schedule-date-filter')?.value || '';
      const statusFilter = document.getElementById('schedule-status-filter')?.value || '';

      let treatments = await DB.getScheduledTreatments();
      const teams = await DB.getTeams();

      if (this.scheduleTeamFilter !== 'all') {
        treatments = treatments.filter(t => t.teamId === this.scheduleTeamFilter);
      }

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        treatments = treatments.filter(t => 
          t.customerNo?.toLowerCase().includes(term) ||
          t.clientName?.toLowerCase().includes(term)
        );
      }

      if (statusFilter) {
        treatments = treatments.filter(t => {
          const status = DB.getTreatmentStatus(t);
          return status === statusFilter;
        });
      }

      if (dateFilter) {
        const today = new Date();
        treatments = treatments.filter(t => {
          const scheduled = new Date(t.dateScheduled);
          switch (dateFilter) {
            case 'today':
              return scheduled.toDateString() === today.toDateString();
            case 'this-week':
              const weekFromNow = new Date(today);
              weekFromNow.setDate(weekFromNow.getDate() + 7);
              return scheduled >= today && scheduled <= weekFromNow;
            case 'this-month':
              return scheduled.getMonth() === today.getMonth() && scheduled.getFullYear() === today.getFullYear();
            default:
              return true;
          }
        });
      }

      treatments = treatments.sort((a, b) => new Date(a.dateScheduled) - new Date(b.dateScheduled));

      document.getElementById('schedule-count').textContent = `${treatments.length} treatments`;
      const tbody = document.getElementById('schedule-table-body');

      if (treatments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>No treatments found</p></td></tr>`;
      } else {
        tbody.innerHTML = treatments.map(t => {
          const status = DB.getTreatmentStatus(t);
          const statusClass = status === 'Completed' ? 'badge-success' : status === 'Lapsed' ? 'badge-danger' : status === 'Cancelled' ? 'badge-muted' : 'badge-info';
          const team = teams.find(team => team.id === t.teamId);
          const teamDisplay = team ? team.name : (t.teamId || '-');
          
          return `
            <tr>
              <td>${t.customerNo}</td>
              <td>${t.clientName}</td>
              <td>#${t.treatmentNo}</td>
              <td>${Validation.formatDate(t.dateScheduled)}</td>
              <td>${t.timeSlot || '-'}</td>
              <td>${teamDisplay}</td>
              <td>${t.treatmentType || '-'}</td>
              <td><span class="badge ${statusClass}">${status}</span></td>
              <td class="actions-cell">
                ${status === 'Scheduled' || status === 'Lapsed' ? `
                  <button class="btn btn-sm btn-success" onclick="UI.openTreatmentModal('${t.id}', 'complete')" title="Complete">✓</button>
                  <button class="btn btn-sm btn-outline" onclick="UI.openTreatmentModal('${t.id}', 'reschedule')" title="Reschedule">📅</button>
                  <button class="btn btn-sm btn-danger" onclick="UI.openTreatmentModal('${t.id}', 'cancel')" title="Cancel">✗</button>
                ` : '-'}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering schedule:', error);
      this.showToast('Error loading schedule', 'error');
    } finally {
      this.hideLoading();
    }
  },

  setScheduleTeamFilter(filter, btn) {
    this.scheduleTeamFilter = filter;
    document.querySelectorAll('#schedule-team-tabs .team-filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.renderScheduleReport();
  },

  // ===== TREATMENT MODAL =====
  async openTreatmentModal(treatmentId, actionType) {
    this.showLoading();
    try {
      const treatment = await DB.getTreatmentById(treatmentId);
      if (!treatment) {
        this.showToast('Treatment not found', 'error');
        return;
      }

      const client = await DB.getClientByCustomerNo(treatment.customerNo);

      document.getElementById('treatment-action-id').value = treatmentId;
      document.getElementById('treatment-action-type').value = actionType;
      document.getElementById('treatment-client-display').textContent = client?.clientName || treatment.customerNo;
      document.getElementById('treatment-date-display').textContent = Validation.formatDate(treatment.dateScheduled);

      // Hide all field sections
      document.getElementById('complete-fields').classList.add('hidden');
      document.getElementById('reschedule-fields').classList.add('hidden');
      document.getElementById('cancel-fields').classList.add('hidden');

      // Show appropriate fields
      if (actionType === 'complete') {
        document.getElementById('treatment-modal-title').textContent = 'Complete Treatment';
        document.getElementById('complete-fields').classList.remove('hidden');
        document.getElementById('complete-date').value = new Date().toISOString().split('T')[0];
      } else if (actionType === 'reschedule') {
        document.getElementById('treatment-modal-title').textContent = 'Reschedule Treatment';
        document.getElementById('reschedule-fields').classList.remove('hidden');
        // Populate teams dropdown for rescheduling
        await this.loadTeamsToDropdown('reschedule-team', true);
        document.getElementById('reschedule-team').value = treatment.teamId || '';
      } else if (actionType === 'cancel') {
        document.getElementById('treatment-modal-title').textContent = 'Cancel Treatment';
        document.getElementById('cancel-fields').classList.remove('hidden');
      }

      document.getElementById('treatment-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading treatment', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeTreatmentModal() {
    document.getElementById('treatment-modal').classList.add('hidden');
  },

  async executeTreatmentAction() {
    const treatmentId = document.getElementById('treatment-action-id').value;
    const actionType = document.getElementById('treatment-action-type').value;

    this.showLoading();
    try {
      const treatment = await DB.getTreatmentById(treatmentId);
      if (!treatment) throw new Error('Treatment not found');

      if (actionType === 'complete') {
        const dateTreated = document.getElementById('complete-date').value;
        const technician = document.getElementById('complete-technician').value;
        
        if (!dateTreated || !technician) {
          this.showToast('Please fill in date and technician', 'error');
          return;
        }

        treatment.status = 'Completed';
        treatment.dateTreated = dateTreated;
        treatment.technician = technician;
        treatment.chemicalUsed = document.getElementById('complete-chemical').value;
        treatment.notes = document.getElementById('complete-notes').value;

        await DB.saveContractUpdate({
          customerNo: treatment.customerNo,
          changeType: 'Treatment Completed',
          oldValue: treatment.dateScheduled,
          newValue: dateTreated,
          reason: `By ${technician}`
        });

      } else if (actionType === 'reschedule') {
        const newDate = document.getElementById('reschedule-date').value;
        const reason = document.getElementById('reschedule-reason').value;
        const newTeamId = document.getElementById('reschedule-team').value;
        
        if (!newDate || !reason) {
          this.showToast('Please fill in new date and reason', 'error');
          return;
        }

        const oldDate = treatment.dateScheduled;
        const oldTeamId = treatment.teamId || '';
        
        treatment.dateScheduled = newDate;
        treatment.timeSlot = document.getElementById('reschedule-time').value;
        treatment.statusReason = reason;
        
        // Update team if changed
        if (newTeamId && newTeamId !== oldTeamId) {
          treatment.teamId = newTeamId;
          const teams = await DB.getTeams();
          const newTeam = teams.find(t => t.id === newTeamId);
          const oldTeam = teams.find(t => t.id === oldTeamId);
          
          await DB.saveContractUpdate({
            customerNo: treatment.customerNo,
            changeType: 'Treatment Team Changed',
            oldValue: oldTeam?.name || 'Unassigned',
            newValue: newTeam?.name || 'Unassigned',
            reason: 'During reschedule'
          });
        }

        await DB.saveContractUpdate({
          customerNo: treatment.customerNo,
          changeType: 'Treatment Rescheduled',
          oldValue: oldDate,
          newValue: newDate,
          reason
        });

      } else if (actionType === 'cancel') {
        const reason = document.getElementById('cancel-reason').value;
        
        if (!reason) {
          this.showToast('Please provide a cancellation reason', 'error');
          return;
        }

        treatment.status = 'Cancelled';
        treatment.statusReason = reason;

        await DB.saveContractUpdate({
          customerNo: treatment.customerNo,
          changeType: 'Treatment Cancelled',
          oldValue: treatment.dateScheduled,
          newValue: 'Cancelled',
          reason
        });
      }

      await DB.updateTreatment(treatment);
      this.closeTreatmentModal();
      this.showToast('Treatment updated successfully');
      this.refreshCurrentPage();
    } catch (error) {
      this.showToast('Error updating treatment: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== CALENDAR =====
  async renderCalendar() {
    this.showLoading();
    try {
      const year = this.calendarDate.getFullYear();
      const month = this.calendarDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDay = firstDay.getDay();
      const daysInMonth = lastDay.getDate();

      document.getElementById('calendar-title').textContent = 
        `${firstDay.toLocaleString('default', { month: 'long' })} ${year}`;

      let treatments = await DB.getScheduledTreatments();

      if (this.calendarTeamFilter !== 'all') {
        treatments = treatments.filter(t => t.teamId === this.calendarTeamFilter);
      }

      if (this.calendarFilter !== 'all') {
        treatments = treatments.filter(t => {
          const status = DB.getTreatmentStatus(t);
          return status.toLowerCase() === this.calendarFilter.toLowerCase();
        });
      }

      const treatmentsByDate = {};
      treatments.forEach(t => {
        const date = t.dateScheduled;
        if (!treatmentsByDate[date]) treatmentsByDate[date] = [];
        treatmentsByDate[date].push(t);
      });

      let calendarHTML = '';
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      weekdays.forEach(day => {
        calendarHTML += `<div class="calendar-weekday">${day}</div>`;
      });

      // Previous month days
      const prevMonthDays = new Date(year, month, 0).getDate();
      for (let i = startDay - 1; i >= 0; i--) {
        calendarHTML += `<div class="calendar-day other-month"><span class="calendar-day-number">${prevMonthDays - i}</span></div>`;
      }

      // Current month days
      const today = new Date();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
        const dayTreatments = treatmentsByDate[dateStr] || [];

        calendarHTML += `
          <div class="calendar-day ${isToday ? 'today' : ''}">
            <span class="calendar-day-number">${day}</span>
            <div class="calendar-events">
              ${dayTreatments.slice(0, 3).map(t => {
                const status = DB.getTreatmentStatus(t);
                const statusClass = status === 'Completed' ? 'completed' : status === 'Lapsed' ? 'lapsed' : 'scheduled';
                return `<div class="calendar-event ${statusClass} ${t.teamId}">${t.clientName || t.customerNo}</div>`;
              }).join('')}
              ${dayTreatments.length > 3 ? `<div class="calendar-event" style="background: var(--muted);">+${dayTreatments.length - 3} more</div>` : ''}
            </div>
          </div>
        `;
      }

      // Next month days
      const totalCells = startDay + daysInMonth;
      const remainingCells = 7 - (totalCells % 7);
      if (remainingCells < 7) {
        for (let i = 1; i <= remainingCells; i++) {
          calendarHTML += `<div class="calendar-day other-month"><span class="calendar-day-number">${i}</span></div>`;
        }
      }

      document.getElementById('calendar-grid').innerHTML = calendarHTML;
    } catch (error) {
      console.error('Error rendering calendar:', error);
      this.showToast('Error loading calendar', 'error');
    } finally {
      this.hideLoading();
    }
  },

  prevMonth() {
    this.calendarDate.setMonth(this.calendarDate.getMonth() - 1);
    this.renderCalendar();
  },

  nextMonth() {
    this.calendarDate.setMonth(this.calendarDate.getMonth() + 1);
    this.renderCalendar();
  },

  goToToday() {
    this.calendarDate = new Date();
    this.renderCalendar();
  },

  setCalendarFilter(filter, btn) {
    this.calendarFilter = filter;
    document.querySelectorAll('.calendar-filters .filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.renderCalendar();
  },

  setCalendarTeamFilter(filter, btn) {
    this.calendarTeamFilter = filter;
    document.querySelectorAll('#calendar-team-tabs .team-filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.renderCalendar();
  },

  // ===== RENEWALS =====
  async renderRenewalReport() {
    this.showLoading();
    try {
      const renewalContracts = await DB.getContractsForRenewal();
      const renewals = await DB.getRenewals();

      const tbody = document.getElementById('renewal-table-body');
      if (renewalContracts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>No contracts due for renewal</p></td></tr>`;
      } else {
        tbody.innerHTML = renewalContracts.map(c => {
          const renewal = renewals.find(r => r.contractId === c.id);
          const status = renewal?.renewalStatus || 'Not Started';
          
          return `
            <tr>
              <td>${c.customerNo}</td>
              <td>${c.clientName}</td>
              <td>${Validation.formatDate(c.contractEndDate)}</td>
              <td>${Validation.formatCurrency(c.totalAmount)}</td>
              <td>${c.warrantyYears || 1}Y</td>
              <td><span class="badge badge-warning">${status}</span></td>
              <td>${renewal?.agentHandling || '-'}</td>
              <td>${renewal?.communicationSource || '-'}</td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" title="Update Status">📝</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering renewals:', error);
      this.showToast('Error loading renewals', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== COMPLAINTS =====
  async renderComplaintsPage() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('complaints-search')?.value || '';
      const priorityFilter = document.getElementById('complaints-priority-filter')?.value || '';
      const statusFilter = document.getElementById('complaints-status-filter')?.value || '';

      let complaints = await DB.getComplaints();

      // Enrich with client names
      const enrichedComplaints = await Promise.all(complaints.map(async c => {
        const client = await DB.getClientByCustomerNo(c.customerNo);
        return { ...c, clientName: client?.clientName || 'Unknown' };
      }));

      let filtered = enrichedComplaints;

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(c => 
          c.customerNo?.toLowerCase().includes(term) ||
          c.description?.toLowerCase().includes(term)
        );
      }

      if (priorityFilter) {
        filtered = filtered.filter(c => c.priorityLevel === priorityFilter);
      }

      if (statusFilter) {
        filtered = filtered.filter(c => c.status === statusFilter);
      }

      filtered = filtered.sort((a, b) => new Date(b.dateReported) - new Date(a.dateReported));

      document.getElementById('complaints-count').textContent = `${filtered.length} complaints`;
      const tbody = document.getElementById('complaints-table-body');

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><p>No complaints found</p></td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(c => {
          const priorityClass = c.priorityLevel === 'High' ? 'badge-danger' : c.priorityLevel === 'Medium' ? 'badge-warning' : 'badge-info';
          const statusClass = c.status === 'Completed' ? 'badge-success' : c.status === 'In Progress' ? 'badge-info' : 'badge-warning';
          return `
            <tr>
              <td>${Validation.formatDate(c.dateReported)}</td>
              <td>${c.clientName}</td>
              <td class="truncate">${c.description || '-'}</td>
              <td><span class="badge ${priorityClass}">${c.priorityLevel}</span></td>
              <td><span class="badge ${statusClass}">${c.status}</span></td>
              <td>${c.assignedTo || '-'}</td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="UI.editComplaint('${c.id}')" title="Edit">✏️</button>
                ${c.status !== 'Completed' ? `<button class="btn btn-sm btn-success" onclick="UI.completeComplaint('${c.id}')" title="Complete">✓</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="UI.deleteComplaint('${c.id}')" title="Delete">🗑️</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering complaints:', error);
      this.showToast('Error loading complaints', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async openAddComplaintModal() {
    document.getElementById('complaint-id').value = '';
    document.getElementById('complaint-modal-title').textContent = 'Add Complaint';
    document.getElementById('complaint-form').reset();
    document.getElementById('complaint-date').value = new Date().toISOString().split('T')[0];

    // Populate customer dropdown
    const clients = await DB.getClients();
    const customerSelect = document.getElementById('complaint-customer');
    customerSelect.innerHTML = `<option value="">Select Customer</option>` +
      clients.map(c => `<option value="${c.customerNo}">${c.customerNo} - ${c.clientName}</option>`).join('');

    // Populate teams dropdown
    await this.loadTeamsToDropdown('complaint-assigned', true);

    document.getElementById('complaint-modal').classList.remove('hidden');
  },

  async editComplaint(complaintId) {
    this.showLoading();
    try {
      const complaint = await DB.getComplaintById(complaintId);
      if (!complaint) {
        this.showToast('Complaint not found', 'error');
        return;
      }

      document.getElementById('complaint-id').value = complaintId;
      document.getElementById('complaint-modal-title').textContent = 'Edit Complaint';

      // Populate customer dropdown
      const clients = await DB.getClients();
      const customerSelect = document.getElementById('complaint-customer');
      customerSelect.innerHTML = `<option value="">Select Customer</option>` +
        clients.map(c => `<option value="${c.customerNo}" ${c.customerNo === complaint.customerNo ? 'selected' : ''}>${c.customerNo} - ${c.clientName}</option>`).join('');

      // Populate teams dropdown
      await this.loadTeamsToDropdown('complaint-assigned', true);
      document.getElementById('complaint-assigned').value = complaint.assignedTo || '';

      document.getElementById('complaint-date').value = complaint.dateReported || '';
      document.getElementById('complaint-priority').value = complaint.priorityLevel || 'Low';
      document.getElementById('complaint-description').value = complaint.description || '';
      document.getElementById('complaint-resolution').value = complaint.resolutionNotes || '';

      document.getElementById('complaint-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading complaint', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeComplaintModal() {
    document.getElementById('complaint-modal').classList.add('hidden');
  },

  async saveComplaint() {
    const customerNo = document.getElementById('complaint-customer').value;
    const dateReported = document.getElementById('complaint-date').value;
    const description = document.getElementById('complaint-description').value.trim();

    if (!customerNo || !dateReported || !description) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }

    this.showLoading();
    try {
      const complaintId = document.getElementById('complaint-id').value;

      const complaint = {
        id: complaintId || null,
        customerNo,
        dateReported,
        description,
        priorityLevel: document.getElementById('complaint-priority').value,
        assignedTo: document.getElementById('complaint-assigned').value,
        resolutionNotes: document.getElementById('complaint-resolution').value.trim(),
        status: complaintId ? (await DB.getComplaintById(complaintId))?.status || 'Open' : 'Open',
        createdAt: complaintId ? undefined : new Date().toISOString()
      };

      await DB.saveComplaint(complaint);

      await DB.saveContractUpdate({
        customerNo,
        changeType: complaintId ? 'Complaint Updated' : 'Complaint Created',
        oldValue: '-',
        newValue: description.substring(0, 50),
        reason: complaint.priorityLevel
      });

      this.closeComplaintModal();
      this.showToast(complaintId ? 'Complaint updated' : 'Complaint created');
      this.renderComplaintsPage();
    } catch (error) {
      this.showToast('Error saving complaint: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  },

  async completeComplaint(complaintId) {
    this.showLoading();
    try {
      const complaint = await DB.getComplaintById(complaintId);
      if (!complaint) throw new Error('Complaint not found');

      complaint.status = 'Completed';
      complaint.completedDate = new Date().toISOString().split('T')[0];

      await DB.saveComplaint(complaint);

      await DB.saveContractUpdate({
        customerNo: complaint.customerNo,
        changeType: 'Complaint Completed',
        oldValue: 'Open',
        newValue: 'Completed',
        reason: complaint.description?.substring(0, 50)
      });

      this.showToast('Complaint marked as completed');
      this.renderComplaintsPage();
    } catch (error) {
      this.showToast('Error completing complaint', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async deleteComplaint(complaintId) {
    this.showConfirm('Delete Complaint', 'Are you sure you want to delete this complaint?', async () => {
      this.showLoading();
      try {
        await DB.deleteComplaint(complaintId);
        this.showToast('Complaint deleted');
        this.renderComplaintsPage();
      } catch (error) {
        this.showToast('Error deleting complaint', 'error');
      } finally {
        this.hideLoading();
      }
    });
  },

  // ===== UNTREATED =====
  async renderUntreatedReport() {
    this.showLoading();
    try {
      let treatments = await DB.getUntreatedTreatments();

      document.getElementById('untreated-count').textContent = `${treatments.length} overdue treatments`;
      const tbody = document.getElementById('untreated-table-body');

      if (treatments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><p>No overdue treatments</p></td></tr>`;
      } else {
        tbody.innerHTML = treatments.map(t => {
          const severityClass = t.daysOverdue > 30 ? 'badge-danger' : t.daysOverdue > 14 ? 'badge-warning' : 'badge-info';
          const severity = t.daysOverdue > 30 ? 'Critical' : t.daysOverdue > 14 ? 'High' : 'Medium';
          
          return `
            <tr>
              <td>${t.clientName}</td>
              <td>${t.treatmentType || '-'}</td>
              <td>${Validation.formatDate(t.dateScheduled)}</td>
              <td style="color: var(--status-danger); font-weight: 500;">${t.daysOverdue} days</td>
              <td>${t.statusReason || 'Not specified'}</td>
              <td>${t.contactNumber || '-'}</td>
              <td><span class="badge ${severityClass}">${severity}</span></td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="UI.openTreatmentModal('${t.id}', 'reschedule')" title="Reschedule">📅</button>
                <button class="btn btn-sm btn-success" onclick="UI.openTreatmentModal('${t.id}', 'complete')" title="Complete">✓</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering untreated:', error);
      this.showToast('Error loading untreated treatments', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== INSPECTIONS =====
  async renderInspectionsPage() {
    this.showLoading();
    try {
      let inspections = await DB.getInspections();
      inspections = inspections.sort((a, b) => new Date(b.inspectionDate) - new Date(a.inspectionDate));

      document.getElementById('inspections-count').textContent = `${inspections.length} inspections`;
      const tbody = document.getElementById('inspections-table-body');

      if (inspections.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state"><p>No inspections found</p></td></tr>`;
      } else {
        tbody.innerHTML = inspections.map(i => {
          const statusClass = i.status === 'Converted' ? 'badge-success' : i.status === 'Completed' ? 'badge-info' : i.status === 'Lost' ? 'badge-danger' : 'badge-warning';
          return `
            <tr>
              <td>${Validation.formatDate(i.inspectionDate)}</td>
              <td>${i.clientName}</td>
              <td>${i.contactNumber || '-'}</td>
              <td class="truncate">${i.address || '-'}</td>
              <td>${i.inspectedBy || '-'}</td>
              <td>${Array.isArray(i.pestProblems) ? i.pestProblems.join(', ') : i.pestProblems || '-'}</td>
              <td><span class="badge ${statusClass}">${i.status}</span></td>
              <td>${i.conversionDate ? Validation.formatDate(i.conversionDate) : '-'}</td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-outline" onclick="UI.editInspection('${i.id}')" title="Edit">✏️</button>
                ${i.status !== 'Converted' ? `<button class="btn btn-sm btn-success" onclick="UI.convertInspection('${i.id}')" title="Convert">💼</button>` : ''}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering inspections:', error);
      this.showToast('Error loading inspections', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async openAddInspectionModal() {
    document.getElementById('inspection-id').value = '';
    document.getElementById('inspection-modal-title').textContent = 'Add Inspection';
    document.getElementById('inspection-form').reset();
    document.getElementById('inspection-date').value = new Date().toISOString().split('T')[0];
    
    // Populate teams dropdown
    await this.loadTeamsToDropdown('inspection-by', true);
    
    document.getElementById('inspection-modal').classList.remove('hidden');
  },

  async editInspection(inspectionId) {
    this.showLoading();
    try {
      const inspection = await DB.getInspectionById(inspectionId);
      if (!inspection) {
        this.showToast('Inspection not found', 'error');
        return;
      }

      document.getElementById('inspection-id').value = inspectionId;
      document.getElementById('inspection-modal-title').textContent = 'Edit Inspection';
      document.getElementById('inspection-client-name').value = inspection.clientName || '';
      document.getElementById('inspection-contact').value = inspection.contactNumber || '';
      document.getElementById('inspection-date').value = inspection.inspectionDate || '';
      document.getElementById('inspection-address').value = inspection.address || '';
      document.getElementById('inspection-notes').value = inspection.notes || '';

      // Populate teams dropdown
      await this.loadTeamsToDropdown('inspection-by', true);
      document.getElementById('inspection-by').value = inspection.inspectedBy || '';

      // Check pest problems
      const pests = Array.isArray(inspection.pestProblems) ? inspection.pestProblems : [];
      document.querySelectorAll('#inspection-pest-checkboxes input').forEach(cb => {
        cb.checked = pests.includes(cb.value);
      });

      document.getElementById('inspection-modal').classList.remove('hidden');
    } catch (error) {
      this.showToast('Error loading inspection', 'error');
    } finally {
      this.hideLoading();
    }
  },

  closeInspectionModal() {
    document.getElementById('inspection-modal').classList.add('hidden');
  },

  async saveInspection() {
    const clientName = document.getElementById('inspection-client-name').value.trim();
    const contactNumber = document.getElementById('inspection-contact').value.trim();
    const inspectionDate = document.getElementById('inspection-date').value;
    const inspectedBy = document.getElementById('inspection-by').value;
    const address = document.getElementById('inspection-address').value.trim();

    if (!clientName || !contactNumber || !inspectionDate || !inspectedBy || !address) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }

    this.showLoading();
    try {
      const inspectionId = document.getElementById('inspection-id').value;
      const pestProblems = Array.from(document.querySelectorAll('#inspection-pest-checkboxes input:checked')).map(cb => cb.value);

      const inspection = {
        id: inspectionId || null,
        clientName,
        contactNumber,
        inspectionDate,
        inspectedBy,
        address,
        pestProblems,
        notes: document.getElementById('inspection-notes').value.trim(),
        status: inspectionId ? (await DB.getInspectionById(inspectionId))?.status || 'Pending' : 'Pending',
        createdAt: inspectionId ? undefined : new Date().toISOString()
      };

      await DB.saveInspection(inspection);

      this.closeInspectionModal();
      this.showToast(inspectionId ? 'Inspection updated' : 'Inspection created');
      this.renderInspectionsPage();
    } catch (error) {
      this.showToast('Error saving inspection: ' + error.message, 'error');
    } finally {
      this.hideLoading();
    }
  },

  async convertInspection(inspectionId) {
    this.showToast('Convert inspection - redirecting to new contract form', 'info');
    // Load inspection data and pre-fill contract form
    const inspection = await DB.getInspectionById(inspectionId);
    if (inspection) {
      this.switchTab('contract');
      // Pre-fill form fields
      document.getElementById('client-type').value = 'new';
      document.getElementById('client-name').value = inspection.clientName || '';
      document.getElementById('contact-number').value = inspection.contactNumber || '';
      document.getElementById('address').value = inspection.address || '';
      
      // Check pests
      const pests = Array.isArray(inspection.pestProblems) ? inspection.pestProblems : [];
      document.querySelectorAll('#pest-checkboxes input').forEach(cb => {
        cb.checked = pests.includes(cb.value);
      });

      // Update inspection status
      inspection.status = 'Converted';
      inspection.conversionDate = new Date().toISOString().split('T')[0];
      await DB.saveInspection(inspection);
    }
  },

  // ===== TEAMS =====
  async renderTeamsPage() {
    this.showLoading();
    try {
      const teams = await DB.getTeams();
      const container = document.getElementById('teams-container');

      if (teams.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No teams configured</p></div>`;
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

      // Add member fields
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

  // ===== FIXED UI.saveTeam: normalize members & omit id on create =====
  async saveTeam() {
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

      // Build team payload: don't include id when creating new (let DB.generateId handle it)
      const team = {
        name: teamName,
        members
      };

      if (teamId) {
        team.id = teamId;
      }

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

  // ===== AUDIT LOG =====
  async renderUpdatesReport() {
    this.showLoading();
    try {
      const searchTerm = document.getElementById('updates-search')?.value || '';
      const typeFilter = document.getElementById('updates-type-filter')?.value || '';

      let updates = await DB.getContractUpdates();

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        updates = updates.filter(u => 
          u.customerNo?.toLowerCase().includes(term) ||
          u.changeType?.toLowerCase().includes(term) ||
          u.updatedBy?.toLowerCase().includes(term)
        );
      }

      if (typeFilter) {
        updates = updates.filter(u => u.changeType === typeFilter);
      }

      updates = updates.sort((a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated));

      document.getElementById('updates-count').textContent = `${updates.length} updates`;
      const tbody = document.getElementById('updates-table-body');

      if (updates.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><p>No updates logged</p></td></tr>`;
      } else {
        tbody.innerHTML = updates.map(u => `
          <tr>
            <td>${new Date(u.dateUpdated).toLocaleString()}</td>
            <td>${u.customerNo || '-'}</td>
            <td><span class="badge badge-muted">${u.changeType}</span></td>
            <td class="truncate">${u.oldValue || '-'}</td>
            <td class="truncate">${u.newValue || '-'}</td>
            <td>${u.reason || '-'}</td>
            <td>${u.updatedBy || 'System'}</td>
          </tr>
        `).join('');
      }
    } catch (error) {
      console.error('Error rendering updates:', error);
      this.showToast('Error loading audit log', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== USERS =====
  async renderUsersPage() {
    if (!Auth.isAdmin()) {
      this.showToast('Access denied', 'error');
      return;
    }
    this.showLoading();
    try {
      const users = await DB.getUsers();
      const tbody = document.getElementById('users-table-body');

      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><p>No users found</p></td></tr>`;
      } else {
        tbody.innerHTML = users.map(u => {
          const statusClass = u.status === 'approved' ? 'badge-success' : u.status === 'denied' ? 'badge-danger' : 'badge-warning';
          return `
            <tr>
              <td>
                <div class="sidebar-user-avatar" style="width: 32px; height: 32px;">
                  ${u.photoURL ? `<img src="${u.photoURL}" alt="">` : (u.displayName || 'U').charAt(0)}
                </div>
              </td>
              <td>${u.displayName || u.email}</td>
              <td>${u.email}</td>
              <td>${u.role || 'user'}</td>
              <td><span class="badge ${statusClass}">${u.status}</span></td>
              <td>${Validation.formatDate(u.createdAt)}</td>
              <td class="actions-cell">
                ${u.status === 'pending' ? `
                  <button class="btn btn-sm btn-success" onclick="UI.approveUser('${u.uid}')">Approve</button>
                  <button class="btn btn-sm btn-danger" onclick="UI.denyUser('${u.uid}')">Deny</button>
                ` : '-'}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (error) {
      console.error('Error rendering users:', error);
      this.showToast('Error loading users', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async approveUser(uid) {
    this.showLoading();
    try {
      await DB.updateUserStatus(uid, 'approved');
      this.showToast('User approved');
      this.renderUsersPage();
    } catch (error) {
      this.showToast('Error approving user', 'error');
    } finally {
      this.hideLoading();
    }
  },

  async denyUser(uid) {
    this.showLoading();
    try {
      await DB.updateUserStatus(uid, 'denied');
      this.showToast('User denied');
      this.renderUsersPage();
    } catch (error) {
      this.showToast('Error denying user', 'error');
    } finally {
      this.hideLoading();
    }
  },

  // ===== CONTRACT FORM =====
  async loadExistingClients() {
    const clients = await DB.getClients();
    const select = document.getElementById('existing-client-select');
    if (select) {
      select.innerHTML = `<option value="">Select client...</option>` +
        clients.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''))
          .map(c => `<option value="${c.customerNo}">${c.customerNo} - ${c.clientName}</option>`).join('');
    }
  },

  generateTreatments() {
    const startDate = document.getElementById('contract-start').value;
    const months = document.getElementById('contract-length').value;
    const frequency = document.getElementById('treatment-frequency').value;
    const treatmentType = document.getElementById('treatment-method').value;
    const teamId = document.getElementById('assigned-team').value;
    const timeSlot = document.getElementById('time-slot').value;

    if (!startDate || !months || !frequency || !treatmentType) {
      this.showToast('Please fill in start date, length, frequency, and treatment method', 'error');
      return;
    }

    this.generatedTreatments = DB.generateTreatmentSchedule('temp', 'temp', startDate, months, frequency, treatmentType, teamId, timeSlot);

    const tbody = document.getElementById('treatment-table-body');
    tbody.innerHTML = this.generatedTreatments.map((t, i) => `
      <tr>
        <td>${t.treatmentNo}</td>
        <td>${Validation.formatDate(t.dateScheduled)}</td>
        <td>${t.timeSlot || '-'}</td>
        <td>${t.teamId || '-'}</td>
        <td><span class="badge badge-info">Scheduled</span></td>
      </tr>
    `).join('');

    document.getElementById('treatment-table-container').classList.remove('hidden');
    this.showToast(`Generated ${this.generatedTreatments.length} treatments`);
  },

  // ===== EXPORT FUNCTIONS =====
  exportClientsCSV() {
    this.showToast('Export feature - coming soon', 'info');
  },

  exportContractsCSV() {
    this.showToast('Export feature - coming soon', 'info');
  },

  exportPaymentsCSV() {
    this.showToast('Export feature - coming soon', 'info');
  },

  exportAuditLogCSV() {
    this.showToast('Export feature - coming soon', 'info');
  }
};

// ============= EVENT LISTENERS =============
document.addEventListener('DOMContentLoaded', () => {
  // Initialize authentication
  Auth.init();

  // Google login button
  document.getElementById('google-login-btn')?.addEventListener('click', () => {
    Auth.signInWithGoogle();
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('visible');
  });

  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  });

  // Navigation
  document.querySelectorAll('.nav-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) UI.switchTab(tab);
    });
  });

  // Search inputs - debounce
  const debounce = (fn, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  };

  document.getElementById('clients-search')?.addEventListener('input', debounce(() => UI.renderClientsPage(), 300));
  document.getElementById('contracts-search')?.addEventListener('input', debounce(() => UI.renderContractsPage(), 300));
  document.getElementById('contracts-status-filter')?.addEventListener('change', () => UI.renderContractsPage());
  document.getElementById('payments-search')?.addEventListener('input', debounce(() => UI.renderPaymentsPage(), 300));
  document.getElementById('payments-status-filter')?.addEventListener('change', () => UI.renderPaymentsPage());
  document.getElementById('schedule-search')?.addEventListener('input', debounce(() => UI.renderScheduleReport(), 300));
  document.getElementById('schedule-date-filter')?.addEventListener('change', () => UI.renderScheduleReport());
  document.getElementById('schedule-status-filter')?.addEventListener('change', () => UI.renderScheduleReport());
  document.getElementById('complaints-search')?.addEventListener('input', debounce(() => UI.renderComplaintsPage(), 300));
  document.getElementById('complaints-priority-filter')?.addEventListener('change', () => UI.renderComplaintsPage());
  document.getElementById('complaints-status-filter')?.addEventListener('change', () => UI.renderComplaintsPage());
  document.getElementById('updates-search')?.addEventListener('input', debounce(() => UI.renderUpdatesReport(), 300));
  document.getElementById('updates-type-filter')?.addEventListener('change', () => UI.renderUpdatesReport());

  // Contract form helpers
  document.getElementById('client-type')?.addEventListener('change', (e) => {
    const isExisting = e.target.value === 'existing';
    document.getElementById('existing-client-group').classList.toggle('hidden', !isExisting);
    if (isExisting) {
      UI.loadExistingClients();
    }
  });

  document.getElementById('contract-start')?.addEventListener('change', () => {
    const startDate = document.getElementById('contract-start').value;
    const months = document.getElementById('contract-length').value;
    if (startDate && months) {
      document.getElementById('contract-end').value = DB.calculateEndDate(startDate, months);
    }
  });

  document.getElementById('contract-length')?.addEventListener('input', () => {
    const startDate = document.getElementById('contract-start').value;
    const months = document.getElementById('contract-length').value;
    if (startDate && months) {
      document.getElementById('contract-end').value = DB.calculateEndDate(startDate, months);
    }
  });

  document.getElementById('downpayment-percent')?.addEventListener('input', (e) => {
    const percent = e.target.value;
    document.getElementById('downpayment-percent-display').textContent = `${percent}%`;
    
    const total = parseFloat(document.getElementById('total-amount').value) || 0;
    const downpayment = total * (percent / 100);
    document.getElementById('downpayment-amount').value = downpayment.toFixed(2);
  });

  document.getElementById('total-amount')?.addEventListener('input', () => {
    const total = parseFloat(document.getElementById('total-amount').value) || 0;
    const percent = parseInt(document.getElementById('downpayment-percent').value) || 0;
    const downpayment = total * (percent / 100);
    document.getElementById('downpayment-amount').value = downpayment.toFixed(2);
  });

  // Reset form button
  document.getElementById('reset-form-btn')?.addEventListener('click', () => {
    document.getElementById('contract-form').reset();
    document.getElementById('treatment-table-container').classList.add('hidden');
    UI.generatedTreatments = [];
  });

  // Contract form submission
  document.getElementById('contract-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validate required fields
    const clientName = document.getElementById('client-name').value.trim();
    const contactPerson = document.getElementById('contact-person').value.trim();
    const contactNumber = document.getElementById('contact-number').value.trim();
    const address = document.getElementById('address').value.trim();
    const treatmentMethod = document.getElementById('treatment-method').value;
    const contractLength = document.getElementById('contract-length').value;
    const contractStart = document.getElementById('contract-start').value;
    const treatmentFrequency = document.getElementById('treatment-frequency').value;
    const totalAmount = document.getElementById('total-amount').value;
    const salesAgent = document.getElementById('sales-agent').value;

    if (!clientName || !contactPerson || !contactNumber || !address || !treatmentMethod || !contractLength || !contractStart || !treatmentFrequency || !totalAmount || !salesAgent) {
      UI.showToast('Please fill in all required fields', 'error');
      return;
    }

    if (UI.generatedTreatments.length === 0) {
      UI.showToast('Please generate treatment plan before saving', 'error');
      return;
    }

    UI.showLoading();
    try {
      const clientType = document.getElementById('client-type').value;
      let customerNo;
      let client;

      if (clientType === 'existing') {
        customerNo = document.getElementById('existing-client-select').value;
        client = await DB.getClientByCustomerNo(customerNo);
      } else {
        customerNo = await DB.generateCustomerNo();
        
        // Get pest problems
        const pests = Array.from(document.querySelectorAll('#pest-checkboxes input:checked')).map(cb => cb.value);

        client = {
          customerNo,
          clientName,
          contactPerson,
          contactNumber,
          address,
          areaSize: document.getElementById('area-size').value,
          email: document.getElementById('email').value,
          source: document.getElementById('source').value,
          salesAgent,
          pestProblems: pests,
          createdAt: new Date().toISOString()
        };

        await DB.saveClient(client);
      }

      // Get next contract number
      const contractNumber = await DB.getNextContractNumber(customerNo);

      // Create contract
      const contract = {
        customerNo,
        contractNumber,
        contractStartDate: contractStart,
        contractEndDate: DB.calculateEndDate(contractStart, contractLength),
        contractLength: parseInt(contractLength),
        treatmentMethod,
        treatmentFrequency,
        totalAmount: parseFloat(totalAmount),
        downpaymentPercent: parseInt(document.getElementById('downpayment-percent').value),
        downpaymentAmount: parseFloat(document.getElementById('downpayment-amount').value) || 0,
        warrantyYears: parseInt(document.getElementById('warranty-years').value) || 1,
        salesAgent,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      const savedContract = await DB.saveContract(contract);

      // Update and save treatments
      const treatments = UI.generatedTreatments.map(t => ({
        ...t,
        id: DB.generateId(),
        contractId: savedContract.id,
        customerNo
      }));

      await DB.saveTreatments(treatments);

      // Log creation
      await DB.saveContractUpdate({
        customerNo,
        changeType: 'Contract Created',
        oldValue: '-',
        newValue: `Contract #${contractNumber}`,
        reason: `${treatmentMethod} - ${Validation.formatCurrency(totalAmount)}`
      });

      // Reset form
      document.getElementById('contract-form').reset();
      document.getElementById('treatment-table-container').classList.add('hidden');
      UI.generatedTreatments = [];

      UI.showToast('Contract created successfully!');
      UI.switchTab('contracts');
    } catch (error) {
      console.error('Error saving contract:', error);
      UI.showToast('Error creating contract: ' + error.message, 'error');
    } finally {
      UI.hideLoading();
    }
  });
});
