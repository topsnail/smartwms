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
          colorPrimary: '#1890ff',
          colorInfo: '#1890ff',
          colorSuccess: '#52c41a',
          colorWarning: '#fa8c16',
          colorError: '#f5222d',
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
