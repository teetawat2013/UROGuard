import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global environment variables provided by Canvas (Prioritize these to avoid token mismatch)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'uroguard-app';
const environmentConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyD1hdREh47-O6Sud4DSfb6fGt9XucQN8ks",
    authDomain: "uroguard-80fd5.firebaseapp.com",
    databaseURL: "https://uroguard-80fd5-default-rtdb.firebaseio.com",
    projectId: "uroguard-80fd5",
    storageBucket: "uroguard-80fd5.firebasestorage.app",
    messagingSenderId: "991921805545",
    appId: "1:991921805545:web:15ea7bceb11f511a167878",
    measurementId: "G-8BB25CL2W2"
};

// Initialize Firebase
const app = initializeApp(environmentConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let allPatients = [];
let chart1, chart2;
let alertShown = false;
let currentUser = null;
const today = new Date(); today.setHours(0,0,0,0);

// Path Rule: /artifacts/{appId}/public/data/{collectionName}
const collectionName = 'patients';
const getCollectionRef = () => collection(db, 'artifacts', appId, 'public', 'data', collectionName);

const translations = {
    th: {
        headerTitle: "UROGuard", headerSubtitle: "Dashboard ติดตาม เฝ้าระวัง และแจ้งเตือนภาวะ CAUTI",
        addPatientBtn: "เพิ่มข้อมูลผู้ป่วยใหม่", dailySummaryTitle: "ข้อมูลสรุปรายวัน",
        activePatients: "ผู้ป่วยคาสายสวน (คน)", reviewNeeded: "ต้องทบทวน (คน)", urgentReview: "ทบทวนเร่งด่วน (คน)", overdue: "เกิน 14 วัน (คน)",
        monthlyTrendTitle: "แนวโน้มวันคาสายสวนสะสม", utiRateTitle: "อัตราติดเชื้อ UTI (ต่อ 1,000 วัน)", patientListTitle: "รายชื่อผู้ป่วย",
        modalAddTitle: "เพิ่มผู้ป่วยใหม่", cancelBtn: "ยกเลิก", saveBtn: "บันทึก", nextBtn: "ถัดไป", backBtn: "ย้อนกลับ",
        statusNormal: "ปกติ", statusReview: "ควรทบทวน", statusUrgent: "เร่งด่วน", statusAlert: "เกิน 14 วัน", statusRemoved: "ถอดแล้ว",
        daysUnit: "วัน", insertedDate: "วันที่ใส่", dueDate: "ครบกำหนด", removedDate: "วันที่ถอด", lastReview: "ทบทวนล่าสุด",
        noReview: "ยังไม่มีการทบทวน", reviewAction: "ทบทวน/ถอด", completed: "เรียบร้อย", noData: "ไม่มีข้อมูล",
    },
    en: {
        headerTitle: "UROGuard", headerSubtitle: "CAUTI Tracking & Alerts Dashboard",
        addPatientBtn: "Add New Patient", dailySummaryTitle: "Daily Snapshot",
        activePatients: "Active (People)", reviewNeeded: "Review Needed", urgentReview: "Urgent", overdue: "Over 14 Days",
        monthlyTrendTitle: "Cumulative Catheter Days", utiRateTitle: "UTI Rate (per 1,000 days)", patientListTitle: "Patient List",
        modalAddTitle: "Add New Patient", cancelBtn: "Cancel", saveBtn: "Save", nextBtn: "Next", backBtn: "Back",
        statusNormal: "Normal", statusReview: "Review", statusUrgent: "Urgent", statusAlert: "Alert", statusRemoved: "Removed",
        daysUnit: "Days", insertedDate: "Inserted", dueDate: "Due", removedDate: "Removed", lastReview: "Last Reviewed",
        noReview: "No review", reviewAction: "Review/Remove", completed: "Done", noData: "No Data",
    }
};

let lang = localStorage.getItem('language') || 'th';
const langBtn = document.getElementById('langSwitcher');

function updateUI() {
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (translations[lang][key]) el.textContent = translations[lang][key];
    });
    langBtn.textContent = lang === 'th' ? 'EN' : 'TH';
    renderList();
    updateStats();
}

langBtn.onclick = () => { lang = lang === 'th' ? 'en' : 'th'; localStorage.setItem('language', lang); updateUI(); };

// --- AUTHENTICATION ---
const initAuth = async () => {
    try {
        // Rule 3: Always signIn FIRST
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token).catch(() => signInAnonymously(auth));
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Auth failed:", error);
    }
};

// Initialize App once Auth is confirmed
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        startSurveillance();
    }
});

function startSurveillance() {
    if (!currentUser) return;
    // RULE 1: Strict Paths
    onSnapshot(getCollectionRef(), (snapshot) => {
        allPatients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(!alertShown) check14DayAlert();
        updateUI();
    }, (error) => {
        console.error("Firestore Listen Error:", error);
    });
}

// Start Auth process
initAuth();

function check14DayAlert() {
    if (allPatients.length === 0) return;
    const targets = allPatients.filter(p => {
        if(p.removalDate) return false;
        const startDate = p.catheterStartDate?.toDate ? p.catheterStartDate.toDate() : new Date(p.catheterStartDate);
        const d = Math.floor((today - startDate)/(1000*3600*24));
        return d === 14;
    });
    if(targets.length > 0) {
        alertShown = true;
        Swal.fire({
            title: 'แจ้งเตือนครบ 14 วัน',
            html: `<ul class='text-left list-disc pl-5'>${targets.map(t => `<li>${t.patientName} (HN: ${t.hn})</li>`).join('')}</ul>`,
            icon: 'warning',
            confirmButtonColor: '#4f46e5'
        });
    }
}

// Modals Logic
const pModal = document.getElementById('patientModal');
const rModal = document.getElementById('reviewModal');
const closeModal = m => m.classList.add('hidden');

document.getElementById('addPatientBtn').onclick = () => {
    if (!currentUser) return;
    document.getElementById('patientForm').reset();
    document.getElementById('catheterStartDate').valueAsDate = new Date();
    showPage(1);
    pModal.classList.remove('hidden');
};

const showPage = p => {
    document.getElementById('formPage1').classList.toggle('hidden', p !== 1);
    document.getElementById('formPage2').classList.toggle('hidden', p !== 2);
    document.getElementById('formBackButton').classList.toggle('hidden', p === 1);
    document.getElementById('formNextButton').classList.toggle('hidden', p === 2);
    document.getElementById('formSaveButton').classList.toggle('hidden', p === 1);
};

document.getElementById('formNextButton').onclick = () => {
    if(document.getElementById('hn').value && document.getElementById('patientNameInput').value) showPage(2);
    else Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอก HN และชื่อผู้ป่วย', 'info');
};
document.getElementById('formBackButton').onclick = () => showPage(1);
document.querySelectorAll('.cancel-btn').forEach(b => b.onclick = () => { closeModal(pModal); closeModal(rModal); });

// --- FORM SUBMISSIONS ---
document.getElementById('patientForm').onsubmit = async e => {
    e.preventDefault();
    if (!currentUser) return;

    const pre = Array.from(document.querySelectorAll('input[name="pre"]:checked')).map(i => i.value);
    const ins = Array.from(document.querySelectorAll('input[name="ins"]:checked')).map(i => i.value);
    
    const data = {
        hn: document.getElementById('hn').value,
        patientName: document.getElementById('patientTitle').value + document.getElementById('patientNameInput').value,
        indication: document.getElementById('indication').value,
        catheterStartDate: new Date(document.getElementById('catheterStartDate').value),
        riskScore: Number(document.getElementById('riskScore').value) || 0,
        checklist_pre: pre,
        checklist_ins: ins,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
    };

    try {
        // Rule 1: Doc Ref
        const newDocRef = doc(getCollectionRef());
        await setDoc(newDocRef, data);
        closeModal(pModal);
        Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', timer: 1500, showConfirmButton: false });
    } catch (err) {
        console.error("Save error:", err);
        Swal.fire('Error', 'บันทึกข้อมูลไม่ได้: ' + err.message, 'error');
    }
};

document.getElementById('reviewForm').onsubmit = async e => {
    e.preventDefault();
    if (!currentUser) return;

    const id = document.getElementById('reviewPatientId').value;
    const action = document.querySelector('input[name="reviewAction"]:checked').value;
    const care = Array.from(document.querySelectorAll('#catheterCareChecklist input:checked')).map(i => i.value);
    
    const up = {
        reviewerName: document.getElementById('reviewerName').value,
        hasUTI: document.getElementById('hasUTI').checked,
        care_checklist: care,
        lastReviewDate: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    if(action === 'remove') {
        const rd = document.getElementById('removalDate').value;
        if(!rd) return Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุวันที่ถอดสายสวน', 'error');
        up.removalDate = new Date(rd);
    } else {
        up.removalDate = null;
    }

    try {
        const docRef = doc(getCollectionRef(), id);
        await updateDoc(docRef, up);
        closeModal(rModal);
        Swal.fire({ icon: 'success', title: 'อัปเดตเรียบร้อย', timer: 1500, showConfirmButton: false });
    } catch (err) {
        console.error("Update error:", err);
        Swal.fire('Error', 'อัปเดตข้อมูลไม่ได้: ' + err.message, 'error');
    }
};

document.querySelectorAll('input[name="reviewAction"]').forEach(radio => {
    radio.onchange = e => {
        document.getElementById('removalDateContainer').classList.toggle('hidden', e.target.value !== 'remove');
    };
});

// --- RENDER & STATS ---
function renderList() {
    const grid = document.getElementById('patientGrid');
    grid.innerHTML = '';
    
    if (allPatients.length === 0) {
        grid.innerHTML = `<div class='col-span-full py-12 text-center text-slate-400'>${translations[lang].noData}</div>`;
        return;
    }

    allPatients.forEach(p => {
        const startDate = p.catheterStartDate?.toDate ? p.catheterStartDate.toDate() : new Date(p.catheterStartDate);
        const removed = !!p.removalDate;
        const endDate = p.removalDate?.toDate ? p.removalDate.toDate() : (p.removalDate ? new Date(p.removalDate) : null);
        
        const days = removed 
            ? Math.ceil((endDate - startDate)/(1000*3600*24)) 
            : Math.floor((today - startDate)/(1000*3600*24));
        
        let sKey = 'normal', sClass = 'status-normal', bClass = 'border-sky-500';
        if(removed) { sKey = 'statusRemoved'; sClass = 'status-removed'; bClass = 'border-emerald-500'; }
        else if(days >= 14) { sKey = 'statusAlert'; sClass = 'status-alert'; bClass = 'border-purple-500'; }
        else if(days >= 10) { sKey = 'statusUrgent'; sClass = 'status-urgent'; bClass = 'border-rose-500'; }
        else if(days >= 7) { sKey = 'statusReview'; sClass = 'status-review'; bClass = 'border-amber-500'; }

        const card = document.createElement('div');
        card.className = `patient-card bg-white rounded-xl shadow-sm border-l-4 ${bClass} p-4 flex flex-col h-full`;
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="overflow-hidden">
                    <p class="font-bold truncate" title="${p.patientName}">${p.patientName}</p>
                    <p class="text-xs text-slate-400">HN: ${p.hn}</p>
                </div>
                <div class="${sClass} status-badge flex-shrink-0"><div class="status-badge-dot"></div>${translations[lang][sKey]}</div>
            </div>
            <div class="text-center mb-4">
                <p class="text-4xl font-bold ${removed?'text-slate-300':'text-indigo-600'}">${days}</p>
                <p class="text-xs text-slate-400 uppercase font-semibold">${translations[lang].daysUnit}</p>
            </div>
            <div class="text-xs space-y-1 text-slate-500 flex-grow">
                <p><strong>${translations[lang].insertedDate}:</strong> ${startDate.toLocaleDateString()}</p>
                ${removed ? `<p><strong>${translations[lang].removedDate}:</strong> ${endDate.toLocaleDateString()}</p>` : ''}
                ${p.lastReviewDate ? `<p><strong>${translations[lang].lastReview}:</strong> ${p.lastReviewDate.toDate ? p.lastReviewDate.toDate().toLocaleString() : new Date(p.lastReviewDate).toLocaleString()}</p>` : ''}
                ${p.hasUTI ? '<p class="text-rose-600 font-bold">⚠️ พบการติดเชื้อ (UTI)</p>' : ''}
            </div>
            <div class="mt-4 pt-3 border-t flex justify-between items-center">
                ${!removed ? `<button onclick="openReview('${p.id}')" class="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors">ทบทวน/ถอด</button>` : `<span class="text-xs text-emerald-600 font-semibold">${translations[lang].completed}</span>`}
                <button onclick="deleteP('${p.id}')" class="text-slate-300 hover:text-red-500 transition-colors px-2 text-xl">&times;</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.openReview = id => {
    const p = allPatients.find(x => x.id === id);
    document.getElementById('reviewPatientId').value = id;
    document.getElementById('reviewPatientInfo').textContent = `${p.patientName} (HN: ${p.hn})`;
    document.getElementById('reviewForm').reset();
    document.getElementById('removalDateContainer').classList.add('hidden');
    rModal.classList.remove('hidden');
};

window.deleteP = id => {
    Swal.fire({ 
        title: 'ยืนยันการลบ?', 
        text: "ข้อมูลนี้จะถูกลบออกจากระบบอย่างถาวร",
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonColor: '#be123c',
        confirmButtonText: 'ลบข้อมูล', 
        cancelButtonText: 'ยกเลิก' 
    }).then(r => {
        if(r.isConfirmed) {
            deleteDoc(doc(getCollectionRef(), id))
                .catch(err => Swal.fire('Error', 'ลบข้อมูลไม่ได้: ' + err.message, 'error'));
        }
    });
};

function updateStats() {
    const active = allPatients.filter(p => !p.removalDate);
    document.getElementById('currentPatientsCount').textContent = active.length;
    
    const getDays = p => {
        const start = p.catheterStartDate?.toDate ? p.catheterStartDate.toDate() : new Date(p.catheterStartDate);
        return Math.floor((today - start)/(1000*3600*24));
    };

    document.getElementById('reviewNeededCount').textContent = active.filter(p => getDays(p) >= 7 && getDays(p) < 10).length;
    document.getElementById('urgentCount').textContent = active.filter(p => getDays(p) >= 10 && getDays(p) < 14).length;
    document.getElementById('alertCount').textContent = active.filter(p => getDays(p) >= 14).length;
    
    updateCharts();
}

function updateCharts() {
    const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const dataNew = new Array(12).fill(0);
    const dataUTI = new Array(12).fill(0);
    
    allPatients.forEach(p => {
        const date = p.catheterStartDate?.toDate ? p.catheterStartDate.toDate() : new Date(p.catheterStartDate);
        const m = date.getMonth();
        dataNew[m]++;
        if(p.hasUTI) dataUTI[m]++;
    });

    if(chart1) chart1.destroy();
    chart1 = new Chart(document.getElementById('monthlyChart'), {
        type: 'line',
        data: { labels: months, datasets: [{ label: 'เคสใหม่', data: dataNew, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', tension: 0.4, fill: true }] },
        options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    if(chart2) chart2.destroy();
    chart2 = new Chart(document.getElementById('utiRateChart'), {
        type: 'bar',
        data: { labels: months, datasets: [{ label: 'จำนวนเคส UTI', data: dataUTI, backgroundColor: '#e11d48', borderRadius: 4 }] },
        options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

updateUI();
