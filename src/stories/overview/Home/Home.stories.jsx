import React from 'react';
import { Title, Subtitle, Description } from '@storybook/blocks';

const HomePage = () => (
  <div style={{ maxWidth: 980, margin: '0 auto', padding: '36px 24px', color: '#101828' }}>
    <div
      style={{
        background: 'linear-gradient(135deg, #e7f1ff 0%, #f7fbff 45%, #fef6e8 100%)',
        border: '1px solid #e4e7ec',
        borderRadius: 16,
        padding: '28px 28px 24px',
        boxShadow: '0 12px 30px rgba(16,24,40,0.08)'
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#175cd3', letterSpacing: 1, textTransform: 'uppercase' }}>
        Welcome to Storybook
      </div>
      <h1 style={{ fontSize: 38, margin: '8px 0 6px' }}>OpenHamClock</h1>
      <p style={{ fontSize: 18, margin: 0, color: '#475467' }}>Real-time amateur radio dashboard for modern operators</p>
      <p style={{ fontSize: 16, lineHeight: 1.6, marginTop: 16, color: '#1d2939' }}>
        OpenHamClock brings DX cluster spots, space weather, propagation predictions, POTA activations, PSKReporter, satellite
        tracking, WSJT-X integration, and local weather into a single, browser-based interface. It is designed for operators
        who want a high-signal, at-a-glance view of the bands and conditions, with panels that refresh independently and can be
        rearranged to match the station workflow.
      </p>
      <div style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={badgeStyle}>🌍 Live map</span>
        <span style={badgeStyle}>📡 DX + POTA</span>
        <span style={badgeStyle}>🛰️ Satellites</span>
        <span style={badgeStyle}>☀️ Space weather</span>
        <span style={badgeStyle}>🧰 Station tools</span>
      </div>
    </div>

    <div style={{ display: 'grid', gap: 20, marginTop: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      <div style={cardStyle}>
        <h2 style={cardTitleStyle}>🧩 What This Project Covers</h2>
        <ul style={listStyle}>
          <li>A modular, data-rich dashboard built around an interactive world map.</li>
          <li>Panels for DX, POTA, PSKReporter, propagation, space weather, contests, and station tools.</li>
          <li>Multiple deployment targets: desktop, Raspberry Pi, or cloud-hosted access.</li>
          <li>Plugin-friendly architecture and a strong open-source community focus.</li>
        </ul>
      </div>
      <div style={cardStyle}>
        <h2 style={cardTitleStyle}>📘 How To Use This Storybook</h2>
        <ul style={listStyle}>
          <li>Browse panels and shared UI components in isolation.</li>
          <li>Validate layout behavior and visual consistency across modules.</li>
          <li>Use stories as a reference when adding new panels or refining existing ones.</li>
        </ul>
      </div>
      <div style={cardStyle}>
        <h2 style={cardTitleStyle}>🚀 Quick Explore</h2>
        <ul style={listStyle}>
          <li>Start with the World Map and DX Cluster panels.</li>
          <li>Check Space Weather and Band Conditions for propagation context.</li>
          <li>Look at the Dockable Layout to see layout flexibility.</li>
        </ul>
      </div>
    </div>
  </div>
);

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: 999,
  background: '#ffffff',
  border: '1px solid #d0d5dd',
  fontSize: 13,
  fontWeight: 600,
  color: '#344054',
  boxShadow: '0 2px 6px rgba(16,24,40,0.06)'
};

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #eaecf0',
  borderRadius: 14,
  padding: '18px 18px 12px',
  boxShadow: '0 8px 20px rgba(16,24,40,0.06)'
};

const cardTitleStyle = {
  fontSize: 18,
  margin: '0 0 10px',
  color: '#101828'
};

const listStyle = {
  lineHeight: 1.7,
  margin: 0,
  paddingLeft: 18,
  color: '#344054'
};

export default {
  title: 'Overview/Home',
  component: HomePage,
  parameters: {
    docs: {
      page: () => (
        <>
          <Title>OpenHamClock</Title>
          <Subtitle>Real-time amateur radio dashboard</Subtitle>
          <Description>
            OpenHamClock brings DX cluster spots, space weather, propagation predictions, POTA activations, PSKReporter,
            satellite tracking, WSJT-X integration, and local weather into a single, browser-based interface. It is designed
            for operators who want a high-signal, at-a-glance view of the bands and conditions, with panels that refresh
            independently and can be rearranged to match the station workflow.
          </Description>
          <h2>What This Project Covers</h2>
          <ul>
            <li>A modular, data-rich dashboard built around an interactive world map.</li>
            <li>Panels for DX, POTA, PSKReporter, propagation, space weather, contests, and station tools.</li>
            <li>Multiple deployment targets: desktop, Raspberry Pi, or cloud-hosted access.</li>
            <li>Plugin-friendly architecture and a strong open-source community focus.</li>
          </ul>
          <h2>How To Use This Storybook</h2>
          <ul>
            <li>Browse panels and shared UI components in isolation.</li>
            <li>Validate layout behavior and visual consistency across modules.</li>
            <li>Use stories as a reference when adding new panels or refining existing ones.</li>
          </ul>
        </>
      )
    }
  }
};

export const Home = {
  render: () => <HomePage />
};
