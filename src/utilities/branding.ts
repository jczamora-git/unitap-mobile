/**
 * UniTap 2.0 Centralized Institutional & Organization Branding Configuration
 *
 * Authoritative source of institutional titles, academic unit names,
 * and organization identity displayed across Digital Student Passes,
 * receipts, and student-facing dashboards.
 */

export const INSTITUTION_CONFIG = {
  name: 'MINDORO STATE UNIVERSITY',
  shortName: 'MinSU',
  collegeName: 'College of Computer Studies',
  organizationName: 'Computer Studies Government',
  organizationAcronym: 'CSG',
  passSubtitle: 'College of Computer Studies - CSG',
} as const;

export const INSTITUTION_NAME = INSTITUTION_CONFIG.name;
export const INSTITUTION_COLLEGE = INSTITUTION_CONFIG.collegeName;
export const INSTITUTION_ORG = INSTITUTION_CONFIG.organizationName;
export const INSTITUTION_PASS_SUBTITLE = INSTITUTION_CONFIG.passSubtitle;

