import { ref, computed } from 'vue';
import type { Student, CreateStudentDto, UpdateStudentDto, YearLevel } from '@/types/student';
import { studentService } from '@/services/student.service';

const students = ref<Student[]>([]);
const currentStudent = ref<Student | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

const searchQuery = ref('');
const filterYear = ref<YearLevel | null>(null);
const filterSection = ref('');

export function useStudents() {
  const filteredStudents = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const compactQuery = query.replace(/[^0-9a-f]/g, '');
    const year = filterYear.value;
    const sec = filterSection.value.trim().toLowerCase();

    return students.value.filter(s => {
      if (year && s.yearLevel !== year) return false;
      if (sec && s.section.toLowerCase() !== sec) return false;

      if (!query) return true;

      const full = `${s.firstName} ${s.middleName || ''} ${s.lastName}`.toLowerCase();
      const first = s.firstName.toLowerCase();
      const last = s.lastName.toLowerCase();
      const course = s.course.toLowerCase();
      const section = s.section.toLowerCase();
      const rfid = (s.rfidUid || '').toLowerCase();
      const rfidCompact = (s.rfidUidCompact || '').toLowerCase();

      return (
        full.includes(query) ||
        first.includes(query) ||
        last.includes(query) ||
        course.includes(query) ||
        section.includes(query) ||
        rfid.includes(query) ||
        (compactQuery.length > 0 && rfidCompact.includes(compactQuery))
      );
    });
  });

  const totalCount = computed(() => students.value.length);

  async function loadStudents(): Promise<Student[]> {
    isLoading.value = true;
    error.value = null;
    try {
      const data = await studentService.getStudents();
      students.value = data;
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      return [];
    } finally {
      isLoading.value = false;
    }
  }

  async function getStudentById(id: string): Promise<Student | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const data = await studentService.getStudent(id);
      currentStudent.value = data;
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function findByRfid(rfidUid: string): Promise<Student | null> {
    return studentService.findStudentByRfid(rfidUid);
  }

  async function checkRfid(rfidUid: string, excludeId?: string) {
    return studentService.checkRfidAvailability(rfidUid, excludeId);
  }

  async function addStudent(dto: CreateStudentDto): Promise<Student> {
    isLoading.value = true;
    error.value = null;
    try {
      const created = await studentService.createStudent(dto);
      await loadStudents();
      currentStudent.value = created;
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateStudent(id: string, dto: UpdateStudentDto): Promise<Student> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await studentService.updateStudent(id, dto);
      await loadStudents();
      if (currentStudent.value && currentStudent.value.id === id) {
        currentStudent.value = updated;
      }
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function replaceRfid(id: string, newRfid: string): Promise<Student> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await studentService.replaceStudentRfid(id, newRfid);
      await loadStudents();
      if (currentStudent.value && currentStudent.value.id === id) {
        currentStudent.value = updated;
      }
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function removeRfid(id: string): Promise<Student> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await studentService.removeStudentRfid(id);
      await loadStudents();
      if (currentStudent.value && currentStudent.value.id === id) {
        currentStudent.value = updated;
      }
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteStudent(id: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      await studentService.deleteStudent(id);
      await loadStudents();
      if (currentStudent.value && currentStudent.value.id === id) {
        currentStudent.value = null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  function resetFilters() {
    searchQuery.value = '';
    filterYear.value = null;
    filterSection.value = '';
  }

  return {
    students,
    currentStudent,
    isLoading,
    error,
    searchQuery,
    filterYear,
    filterSection,
    filteredStudents,
    totalCount,
    loadStudents,
    getStudentById,
    findByRfid,
    checkRfid,
    addStudent,
    updateStudent,
    replaceRfid,
    removeRfid,
    deleteStudent,
    resetFilters
  };
}
