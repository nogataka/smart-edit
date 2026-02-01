export const ja = {
  // Navigation
  nav: {
    dashboard: 'ダッシュボード',
    logs: 'ログ',
    statistics: '統計',
    sessions: 'セッション',
    shutdown: 'シャットダウン'
  },

  // Connection status
  status: {
    connected: '接続中',
    polling: 'ポーリング中',
    disconnected: '切断'
  },

  // Dashboard Overview
  dashboard: {
    welcome: 'Smart Edit へようこそ',
    welcomeWithProject: '{project} へようこそ',
    description: 'コーディングセッションの監視、ログの表示、ツール使用統計の分析ができます。',
    logEntries: 'ログエントリ',
    toolCalls: 'ツール呼び出し',
    totalTokens: '合計トークン',
    topTool: 'よく使うツール',
    currentSession: '現在のセッション',
    toolsUsed: '{count} ツール使用',
    inputOutput: '入力 + 出力',
    calls: '{count} 回',
    noData: 'データなし',
    quickNavigation: 'クイックナビゲーション',
    viewLogs: 'ログを表示',
    viewLogsDesc: 'フィルタ付きリアルタイムログ',
    statisticsDesc: 'ツール使用量とトークン分析',
    sessionsDesc: 'セッション履歴とエクスポート'
  },

  // Statistics Panel
  stats: {
    refresh: '更新',
    loading: '読み込み中...',
    clearStats: '統計をクリア',
    tokenEstimator: 'トークン推定: {name}',
    noStatsYet: 'ツール統計はまだありません。',
    noStatsHint: 'セッション中にツールが使用されると、ここに統計が表示されます。',
    totalCalls: '合計呼び出し',
    inputTokens: '入力トークン',
    outputTokens: '出力トークン',
    totalInput: '入力合計',
    totalOutput: '出力合計',
    mostUsedTool: '最多使用ツール',
    activityOverTime: 'アクティビティ推移',
    noActivityYet: 'アクティビティはまだありません',
    activityHint: 'ツールが使用されるとここに表示されます',
    clearHistory: '履歴をクリア',
    tokenDistribution: 'ツール別トークン分布',
    callDistribution: '呼び出し分布',
    tokenBreakdown: 'トークン内訳',
    noToolData: 'ツール使用データがありません'
  },

  // Log Panel
  logs: {
    searchPlaceholder: 'ログを検索...',
    logLevel: 'ログレベル',
    tool: 'ツール',
    clearFilters: 'フィルタをクリア',
    reloadLogs: 'ログを再読み込み',
    noLogs: '表示するログエントリがありません。',
    noLogsHint: 'サーバーが出力を開始すると、ここにログが表示されます。',
    noMatchingLogs: '現在のフィルタに一致するログがありません。',
    debug: 'デバッグ',
    info: '情報',
    warning: '警告',
    error: 'エラー'
  },

  // Session Panel
  sessions: {
    currentSession: '現在のセッション',
    noActiveSession: 'アクティブなセッションがありません',
    sessionHistory: 'セッション履歴',
    sessionsRecorded: '{count} 件のセッション',
    sessionRecorded: '{count} 件のセッション',
    noHistory: 'セッション履歴がありません。',
    noHistoryHint: 'Smart Edit を使用すると、ここにセッション履歴が表示されます。',
    exportJson: 'JSON エクスポート',
    exportAll: 'すべてエクスポート',
    export: 'エクスポート',
    exportSession: 'セッションをJSONでエクスポート',
    clearHistory: '履歴をクリア',
    started: '開始',
    ended: '終了',
    duration: '時間',
    inProgress: '進行中',
    calls: '呼び出し',
    input: '入力',
    output: '出力',
    tokens: 'トークン',
    active: 'アクティブ',
    confirmClearHistory: 'すべてのセッション履歴をクリアしてもよろしいですか？'
  },

  // Common
  common: {
    close: '閉じる',
    cancel: 'キャンセル',
    confirm: '確認',
    loading: '読み込み中...',
    error: 'エラー',
    success: '成功'
  },

  // Sidebar
  sidebar: {
    expand: 'サイドバーを展開',
    collapse: 'サイドバーを折りたたむ',
    shutdownConfirm: 'Smart Edit サーバーを完全に終了します。',
    project: 'プロジェクト',
    noProject: 'プロジェクト未設定',
    instances: 'プロジェクト'
  },

  // Theme
  theme: {
    switchToLight: 'ライトモードに切り替え',
    switchToDark: 'ダークモードに切り替え'
  }
};
