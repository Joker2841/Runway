import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy 
} from "firebase/firestore";

// Helper to generate UUID
function generateUUID(): string {
  try {
    if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch (e) {
    // fallback
  }
  
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Bootstrap stable anonymous identity on module load
if (typeof window !== "undefined") {
  const existing = localStorage.getItem("runway_anon_uid");
  if (!existing) {
    localStorage.setItem("runway_anon_uid", generateUUID());
  }
}

// Helper to get or generate anonymous UID
export function getAnonUid(): string {
  let uid = localStorage.getItem("runway_anon_uid");
  if (!uid) {
    uid = generateUUID();
    localStorage.setItem("runway_anon_uid", uid);
  }
  return uid;
}

// Local storage key for a given anonymous user ID
function getLocalKey(anonUid: string): string {
  return `runway_commitments_${anonUid}`;
}

// Read all local commitments for an anonymous user ID
function getLocalCommitments(anonUid: string): any[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(getLocalKey(anonUid));
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error("Failed to parse local commitments", e);
    return [];
  }
}

// Save all local commitments for an anonymous user ID
function saveLocalCommitments(anonUid: string, commitments: any[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getLocalKey(anonUid), JSON.stringify(commitments));
}

export async function listCommitments(userId: string): Promise<any[]> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const anonUid = getAnonUid();
    const commitments = getLocalCommitments(anonUid);
    return commitments.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  } else {
    try {
      const q = query(
        collection(db, "commitments"),
        where("userId", "==", currentUser.uid),
        orderBy("createdAt", "desc")
      );
      const querySnapshot = await getDocs(q);
      const list: any[] = [];
      querySnapshot.forEach((docSnap) => {
        list.push({ ...docSnap.data(), id: docSnap.id, docId: docSnap.id });
      });
      return list;
    } catch (err: any) {
      handleFirestoreError(err, OperationType.LIST, "commitments");
    }
  }
}

export async function getCommitment(id: string): Promise<any | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const anonUid = getAnonUid();
    const commitments = getLocalCommitments(anonUid);
    const item = commitments.find((c) => c.id === id || c.docId === id);
    return item || null;
  } else {
    try {
      const docRef = doc(db, "commitments", id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return { ...docSnap.data(), id: docSnap.id, docId: docSnap.id };
      }
      return null;
    } catch (err: any) {
      handleFirestoreError(err, OperationType.GET, `commitments/${id}`);
    }
  }
}

export async function createCommitment(data: any): Promise<any> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const anonUid = getAnonUid();
    const commitments = getLocalCommitments(anonUid);
    
    const id = data.id || "local_" + generateUUID();
    const newRecord = {
      ...data,
      id,
      docId: id,
      userId: anonUid,
    };
    
    commitments.unshift(newRecord);
    saveLocalCommitments(anonUid, commitments);
    return newRecord;
  } else {
    try {
      const commitmentData = { ...data, userId: currentUser.uid };
      if (commitmentData.id || commitmentData.docId) {
        const id = commitmentData.id || commitmentData.docId;
        const docRef = doc(db, "commitments", id);
        await setDoc(docRef, { ...commitmentData, id, docId: id }, { merge: true });
        return { ...commitmentData, id, docId: id };
      } else {
        const docRef = await addDoc(collection(db, "commitments"), commitmentData);
        const id = docRef.id;
        const finalData = { ...commitmentData, id, docId: id };
        await setDoc(docRef, { id, docId: id }, { merge: true });
        return finalData;
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, "commitments");
    }
  }
}

export async function updateCommitment(id: string, data: any): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const anonUid = getAnonUid();
    const commitments = getLocalCommitments(anonUid);
    const index = commitments.findIndex((c) => c.id === id || c.docId === id);
    if (index !== -1) {
      commitments[index] = {
        ...commitments[index],
        ...data,
        id,
        docId: id,
      };
      saveLocalCommitments(anonUid, commitments);
    }
  } else {
    try {
      const docRef = doc(db, "commitments", id);
      await setDoc(docRef, data, { merge: true });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, `commitments/${id}`);
    }
  }
}

export async function deleteCommitment(id: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const anonUid = getAnonUid();
    const commitments = getLocalCommitments(anonUid);
    const filtered = commitments.filter((c) => c.id !== id && c.docId !== id);
    saveLocalCommitments(anonUid, filtered);
  } else {
    try {
      const docRef = doc(db, "commitments", id);
      await deleteDoc(docRef);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `commitments/${id}`);
    }
  }
}
