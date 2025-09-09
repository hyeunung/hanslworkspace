
import { Package, FileText, Clock, CheckCircle } from 'lucide-react'

interface StatsProps {
  stats: {
    total: number
    myRequests: number
    pending: number
    completed: number
  }
}

export default function DashboardStats({ stats }: StatsProps) {
  const statCards = [
    {
      title: '전체 발주요청',
      value: stats.total,
      icon: Package,
      color: 'text-hansl-500',
      bgColor: 'bg-hansl-50'
    },
    {
      title: '내 발주요청',
      value: stats.myRequests,
      icon: FileText,
      color: 'text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      title: '승인 대기',
      value: stats.pending,
      icon: Clock,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50'
    },
    {
      title: '이번 달 완료',
      value: stats.completed,
      icon: CheckCircle,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50'
    }
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat) => {
        const Icon = stat.icon
        return (
          <div
            key={stat.title}
            className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bgColor} p-3 rounded-lg`}>
                <Icon className={`w-5 h-5 ${stat.color}`} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-1">
                {stat.title}
              </p>
              <p className="text-3xl font-bold text-gray-900">
                {stat.value.toLocaleString()}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}