
import AttendanceList from '@/components/employee/AttendanceList'
import { useAuth } from '@/contexts/AuthContext'

export default function AttendancePage() {
  const { currentUserRoles } = useAuth()
  const canManageEmployees = currentUserRoles.includes('superadmin') || currentUserRoles.includes('hr')

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">근태 현황</h1>
          <p className="page-subtitle" style={{ marginTop: '-2px', marginBottom: '-4px' }}>Attendance</p>
        </div>
      </div>
      <AttendanceList canManageEmployees={canManageEmployees} />
    </div>
  )
}
