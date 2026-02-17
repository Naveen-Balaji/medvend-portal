// ================================================
//  MedVend Portal — app.js
//  Handles: Firebase Init, Auth, Firestore CRUD
//  Role-based navigation + prescription management
// ================================================


// ================================================
//  STEP 1: FIREBASE CONFIGURATION
//  -----------------------------------------------
//  Replace the values below with YOUR Firebase
//  project settings from the Firebase Console.
//  Go to: Project Settings → Your apps → Config
// ================================================
const firebaseConfig = {
  apiKey: "AIzaSyDJEYAiXDP8e1Uc6y_o5GAacKYNgr0dSsc",
  authDomain: "medvend-portal.firebaseapp.com",
  projectId: "medvend-portal",
  storageBucket: "medvend-portal.firebasestorage.app",
  messagingSenderId: "804571206386",
  appId: "1:804571206386:web:5de794ff894360e099f66b"
};


// ================================================
//  STEP 2: INITIALIZE FIREBASE
//  Initialize the app, auth, and database
// ================================================
firebase.initializeApp(firebaseConfig);

// Firebase Authentication instance
const auth = firebase.auth();

// Firestore Database instance
const db = firebase.firestore();


// ================================================
//  STEP 3: PAGE DETECTION
//  Check which HTML page is currently open
// ================================================

// Get the current page filename (e.g. "login.html")
const currentPage = window.location.pathname.split('/').pop() || 'index.html';


// ================================================
//  STEP 4: AUTH STATE OBSERVER
//  This runs every time the user's login state changes.
//  It protects dashboard pages from unauthenticated access.
// ================================================
auth.onAuthStateChanged(async (user) => {

  // --- USER IS LOGGED IN ---
  if (user) {
    // If they're on the login page, redirect them away
    if (currentPage === 'login.html') {
      // Fetch their role from Firestore, then redirect
      await redirectBasedOnRole(user);
      return;
    }

    // If they're on a dashboard page, load the data
    if (currentPage === 'dashboard.html') {
      loadPatientDashboard(user);
    }

    if (currentPage === 'doctor.html') {
      loadDoctorDashboard(user);
    }

  // --- USER IS NOT LOGGED IN ---
  } else {
    // Protect dashboard pages — redirect to login if not authenticated
    if (currentPage === 'dashboard.html' || currentPage === 'doctor.html') {
      window.location.href = 'login.html';
    }
  }
});


// ================================================
//  STEP 5: REDIRECT USER BASED ON ROLE
//  Looks up the user's role in Firestore and sends
//  them to the correct dashboard page.
// ================================================
async function redirectBasedOnRole(user) {
  try {
    // Query the 'users' collection for this user's document
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (userDoc.exists) {
      const userData = userDoc.data();

      // Check role and redirect accordingly
      if (userData.role === 'doctor') {
        window.location.href = 'doctor.html';
      } else {
        // Default: treat as patient
        window.location.href = 'dashboard.html';
      }
    } else {
      // User exists in Auth but not in Firestore — show error
      showError('errorMsg', 'User profile not found in database. Contact admin.');
    }
  } catch (error) {
    console.error('Error fetching role:', error);
    showError('errorMsg', 'Error loading user profile: ' + error.message);
  }
}


// ================================================
//  STEP 6: HANDLE LOGIN FORM SUBMISSION
//  Called when the user clicks "Sign In" on login.html
// ================================================
async function handleLogin() {
  // Get form values
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('loginBtn');

  // Basic validation
  if (!email || !password) {
    showError('errorMsg', 'Please enter both email and password.');
    return;
  }

  // Show loading state on button
  btn.textContent = 'Signing in...';
  btn.disabled = true;
  hideMessage('errorMsg');

  try {
    // Firebase sign in with email & password
    await auth.signInWithEmailAndPassword(email, password);
    // onAuthStateChanged will handle the redirect automatically

  } catch (error) {
    // Show friendly error messages
    btn.textContent = 'Sign In';
    btn.disabled = false;

    // Map Firebase error codes to readable messages
    const messages = {
      'auth/user-not-found':  'No account found with this email.',
      'auth/wrong-password':  'Incorrect password. Please try again.',
      'auth/invalid-email':   'Invalid email address format.',
      'auth/too-many-requests': 'Too many failed attempts. Try again later.',
      'auth/invalid-credential': 'Invalid email or password.'
    };

    const msg = messages[error.code] || error.message;
    showError('errorMsg', msg);
  }
}


// ================================================
//  STEP 7: HANDLE LOGOUT
//  Works from any dashboard page
// ================================================
async function handleLogout() {
  try {
    await auth.signOut();
    // Redirect to login page after signing out
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
}


// ================================================
//  STEP 8: LOAD PATIENT DASHBOARD
//  Fetches the patient's user profile + prescription
//  from Firestore and populates the medical card UI.
// ================================================
async function loadPatientDashboard(user) {
  try {
    // ---- 8a. Load user profile from 'users' collection ----
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (!userDoc.exists) {
      console.error('User profile not found');
      return;
    }

    const userData = userDoc.data();

    // Security check: make sure this is actually a patient page
    if (userData.role !== 'patient') {
      // Doctors shouldn't be on patient dashboard
      window.location.href = 'doctor.html';
      return;
    }

    // Show patient name in the top bar greeting
    setTextById('patientName', userData.name || user.email);

    // ---- 8b. Load prescription from 'prescriptions' collection ----
    const prescripQuery = await db.collection('prescriptions')
      .where('patientUID', '==', user.uid)
      .limit(1)
      .get();

    // Hide the loading spinner
    hideById('loadingState');

    if (prescripQuery.empty) {
      // No prescription found — show empty state message
      showById('noPrescrip');
      return;
    }

    // Get the prescription data
    const prescrip = prescripQuery.docs[0].data();

    // ---- 8c. Populate the Medical Card UI ----
    showById('medicalCard');

    // User info
    setTextById('cardName',    userData.name || '—');
    setTextById('cardID',      userData.medicalCardID || '—');
    setTextById('cardEmail',   userData.email || user.email);

    // Format the lastUpdated timestamp (Firestore Timestamp → readable date)
    if (prescrip.lastUpdated) {
      const date = prescrip.lastUpdated.toDate();
      setTextById('cardUpdated', formatDate(date));
    } else {
      setTextById('cardUpdated', '—');
    }

    // Prescription details
    // Medicines might be an array — join with commas for display
    const meds = Array.isArray(prescrip.medicines)
      ? prescrip.medicines.join(', ')
      : (prescrip.medicines || '—');

    setTextById('medicines',   meds);
    setTextById('dosage',      prescrip.dosage      || '—');
    setTextById('refillLimit', prescrip.refillLimit !== undefined
      ? prescrip.refillLimit + ' refills'
      : '—'
    );
    setTextById('expiryDate',  prescrip.expiryDate  || '—');

  } catch (error) {
    console.error('Error loading patient dashboard:', error);
    hideById('loadingState');
    showById('noPrescrip');
  }
}


// ================================================
//  STEP 9: LOAD DOCTOR DASHBOARD
//  Verifies the user is a doctor and sets the name.
// ================================================
async function loadDoctorDashboard(user) {
  try {
    // Fetch doctor's user profile
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (!userDoc.exists) {
      window.location.href = 'login.html';
      return;
    }

    const userData = userDoc.data();

    // Security: if not a doctor, redirect to patient dashboard
    if (userData.role !== 'doctor') {
      window.location.href = 'dashboard.html';
      return;
    }

    // Show doctor name in top bar
    setTextById('doctorName', userData.name || user.email);

  } catch (error) {
    console.error('Error loading doctor dashboard:', error);
  }
}


// ================================================
//  STEP 10: SEARCH PATIENT BY EMAIL
//  Doctor enters a patient email → looks up in Firestore
// ================================================
async function searchPatient() {
  const email = document.getElementById('searchEmail').value.trim().toLowerCase();

  // Reset previous results
  hideById('searchResult');
  hideById('notFoundMsg');

  if (!email) {
    showError('notFoundMsg', 'Please enter a patient email address.');
    return;
  }

  try {
    // Query Firestore: find user where email == entered email AND role == patient
    const querySnapshot = await db.collection('users')
      .where('email', '==', email)
      .where('role', '==', 'patient')
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      // No patient found
      showById('notFoundMsg');
      return;
    }

    // Patient found!
    const patientDoc  = querySnapshot.docs[0];
    const patientData = patientDoc.data();

    // Fill in patient details in the UI
    setTextById('foundName',   patientData.name   || '—');
    setTextById('foundEmail',  patientData.email  || email);
    setTextById('foundCardID', patientData.medicalCardID || '—');
    setTextById('foundUID',    patientDoc.id);

    // Auto-fill the Patient UID field in the prescription form
    // This UID will be saved with the prescription
    document.getElementById('patientUID').value = patientDoc.id;

    // Show the patient found card
    showById('searchResult');

  } catch (error) {
    console.error('Search error:', error);
    showError('notFoundMsg', 'Error searching for patient: ' + error.message);
    showById('notFoundMsg');
  }
}


// ================================================
//  STEP 11: SAVE PRESCRIPTION TO FIRESTORE
//  Doctor fills the form → saves to 'prescriptions' collection
// ================================================
async function savePrescription() {
  // Get the current doctor (logged in user)
  const doctor = auth.currentUser;

  if (!doctor) {
    showError('prescripError', 'You must be logged in to save a prescription.');
    showById('prescripError');
    return;
  }

  // Get form values
  const patientUID   = document.getElementById('patientUID').value.trim();
  const medicineRaw  = document.getElementById('medicineInput').value.trim();
  const dosage       = document.getElementById('dosageInput').value.trim();
  const refillLimit  = document.getElementById('refillInput').value.trim();
  const expiryDate   = document.getElementById('expiryInput').value;

  // Validate: patient must be searched first
  if (!patientUID) {
    showError('prescripError', 'Please search for a patient first and select them.');
    showById('prescripError');
    return;
  }

  // Validate required fields
  if (!medicineRaw || !dosage || !refillLimit || !expiryDate) {
    showError('prescripError', 'Please fill in all prescription fields.');
    showById('prescripError');
    return;
  }

  // Convert comma-separated medicine string to array
  // e.g. "Paracetamol, Amoxicillin" → ["Paracetamol", "Amoxicillin"]
  const medicinesArray = medicineRaw.split(',').map(m => m.trim()).filter(m => m);

  // Show loading state on button
  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  hideById('prescripError');
  hideById('prescripSuccess');

  try {
    // ---- Build the prescription data object ----
    const prescriptionData = {
      patientUID:  patientUID,
      doctorUID:   doctor.uid,        // Record which doctor issued this
      medicines:   medicinesArray,    // Array of medicine names
      dosage:      dosage,
      refillLimit: parseInt(refillLimit, 10),
      expiryDate:  expiryDate,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      // serverTimestamp() uses Firebase server time, not local time
    };

    // ---- Check if prescription already exists for this patient ----
    // We use patientUID as the document ID for easy lookup
    const prescripRef = db.collection('prescriptions').doc(patientUID);
    const existingDoc = await prescripRef.get();

    if (existingDoc.exists) {
      // UPDATE existing prescription
      await prescripRef.update(prescriptionData);
      showSuccess('prescripSuccess', '✅ Prescription updated successfully!');
    } else {
      // CREATE new prescription document
      await prescripRef.set(prescriptionData);
      showSuccess('prescripSuccess', '✅ Prescription created successfully!');
    }

    showById('prescripSuccess');

    // Reset the form after successful save
    document.getElementById('prescriptionForm').reset();
    document.getElementById('patientUID').value = '';

  } catch (error) {
    console.error('Error saving prescription:', error);
    showError('prescripError', 'Error saving prescription: ' + error.message);
    showById('prescripError');
  } finally {
    // Re-enable the button
    btn.textContent = '💾 Save Prescription to Cloud';
    btn.disabled = false;
  }
}


// ================================================
//  STEP 12: HELPER UTILITY FUNCTIONS
//  Small reusable functions to keep code clean
// ================================================

/**
 * Set the text content of an element by its ID
 */
function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Show a DOM element (set display to block)
 */
function showById(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

/**
 * Hide a DOM element (set display to none)
 */
function hideById(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/**
 * Show an error message in an element
 */
function showError(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

/**
 * Show a success message in an element
 */
function showSuccess(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

/**
 * Hide a message element
 */
function hideMessage(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/**
 * Format a JavaScript Date object to a readable string
 * e.g. "17 February 2024"
 */
function formatDate(date) {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}


// ================================================
//  NOTES FOR VENDING MACHINE INTEGRATION
//  -----------------------------------------------
//  The vending machine (IoT device) can fetch
//  prescription data using Firebase Firestore REST API:
//
//  GET https://firestore.googleapis.com/v1/projects/
//      {YOUR_PROJECT_ID}/databases/(default)/documents/
//      prescriptions/{patientUID}?key={YOUR_API_KEY}
//
//  The machine scans the Medical Card ID → looks up
//  the patientUID → fetches prescription → dispenses.
//
//  See README.md for full API integration guide.
// ================================================
