import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App.tsx';
import 'antd/dist/reset.css';
import './index.css';

// 日期选择器、月份、星期等统一使用中文
dayjs.locale('zh-cn');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#4888f0', // blue-500（降低饱和度/深度）
          colorPrimaryHover: '#2563eb', // blue-600
          colorPrimaryActive: '#1d4ed8', // blue-700
          colorInfo: '#4888f0',
          colorSuccess: '#16a34a', // green-600
          colorWarning: '#f59e0b', // amber-500
          colorError: '#e11d48', // rose-600
          borderRadius: 12,
          controlHeight: 36,
          fontSize: 14,
        },
        components: {
          Button: {
            borderRadius: 10,
            controlHeight: 36,
            paddingInline: 12,
          },
          Input: {
            borderRadius: 10,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 10,
            controlHeight: 36,
          },
          Table: {
            borderRadius: 12,
          },
          Modal: {
            borderRadiusLG: 16,
          },
          Card: {
            borderRadiusLG: 16,
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
);
