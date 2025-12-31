const API_BASE = 'http://localhost:8000'

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  if (res.status === 204) return {}
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  return res.text()
}

export function useApi() {
  return {
    fetchDiagrams: () => fetchJson(`${API_BASE}/api/diagrams`),
    getDiagram: (id) => fetchJson(`${API_BASE}/api/diagrams/${id}`),
    createDiagram: (payload) =>
      fetchJson(`${API_BASE}/api/diagrams`, { method: 'POST', body: JSON.stringify(payload) }),
    saveDiagram: (diagram) =>
      fetchJson(`${API_BASE}/api/diagrams/${diagram.id}`, { method: 'PUT', body: JSON.stringify(diagram) }),
    deleteDiagram: (id) => fetchJson(`${API_BASE}/api/diagrams/${id}`, { method: 'DELETE' }),
    duplicateDiagram: (id, name) =>
      fetchJson(`${API_BASE}/api/diagrams/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify(name ? { name } : {}),
      }),
    exportPdf: async (id) => {
      const res = await fetch(`${API_BASE}/api/diagrams/${id}/export/pdf`, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || res.statusText)
      }
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : `diagram-${id}.pdf`
      return { blob, filename }
    },

    fetchTemplates: (query) => {
      const url = query ? `${API_BASE}/api/templates?query=${encodeURIComponent(query)}` : `${API_BASE}/api/templates`
      return fetchJson(url)
    },
    createTemplate: (payload) =>
      fetchJson(`${API_BASE}/api/templates`, { method: 'POST', body: JSON.stringify(payload) }),
    createTemplateFromNode: (payload) =>
      fetchJson(`${API_BASE}/api/templates/from-node`, { method: 'POST', body: JSON.stringify(payload) }),
    deleteTemplate: (id) => fetchJson(`${API_BASE}/api/templates/${id}`, { method: 'DELETE' }),
  }
}
