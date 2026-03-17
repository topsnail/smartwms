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
          borderRadius: 8,
          borderRadiusSM: 8,
          borderRadiusLG: 8,
          controlHeight: 36,
          controlHeightSM: 36,
          controlHeightLG: 36,
          fontSize: 14,
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 36,
            paddingInline: 12,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          InputNumber: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
          },
          DatePicker: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Table: {
            borderRadius: 8,
          },
          Modal: {
            borderRadiusLG: 8,
          },
          Card: {
            borderRadiusLG: 8,
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>,
);
