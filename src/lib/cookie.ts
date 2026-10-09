/**
 * Cookie 持久化工具
 * 用于持久化保存：班级、姓名、学号、同组人
 */

export function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const target = `${encodeURIComponent(name)}=`
  const parts = document.cookie.split(';')
  for (let part of parts) {
    part = part.trim()
    if (part.startsWith(target)) {
      return decodeURIComponent(part.substring(target.length))
    }
  }
  return ''
}

export interface UserProfile {
  className: string
  name: string
  studentId: string
  teammates: string
}

export function getUserProfile(): UserProfile {
  return {
    className: getCookie('rd_className'),
    name: getCookie('rd_name'),
    studentId: getCookie('rd_studentId'),
    teammates: getCookie('rd_teammates'),
  }
}

export function saveUserProfile(profile: Partial<UserProfile>) {
  if (profile.className !== undefined) setCookie('rd_className', profile.className)
  if (profile.name !== undefined) setCookie('rd_name', profile.name)
  if (profile.studentId !== undefined) setCookie('rd_studentId', profile.studentId)
  if (profile.teammates !== undefined) setCookie('rd_teammates', profile.teammates)
}

/** 获取创建报告时的默认日期（格式：YYYY-MM-DD） */
export function getTodayDateString(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
