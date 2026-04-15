
import AttendanceList from '@/components/employee/AttendanceList'
import { useAuth } from '@/contexts/AuthContext'

export default function AttendancePage() {
  const { currentUserRoles } = useAuth()
  const canManageEmployees = currentUserRoles.includes('superadmin') || currentUserRoles.includes('hr')

  return (
    <div className="space-y-6">
      <AttendanceList canManageEmployees={canManageEmployees} />
    </div>
  )
}
