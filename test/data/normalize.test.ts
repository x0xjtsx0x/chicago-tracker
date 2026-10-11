import { describe, it, expect } from 'vitest';
import * as N from '../../src/server/data/normalize.js';

describe('normalizers', () => {
  it('pay block: "." hour limit becomes null; paths + bbox', () => {
    const b = N.normPayBlock({
      attributes: { BLOCK_ID: 'B370603', STREET_NAME: 'S HOMAN AVE', BLOCK_START: 2553, BLOCK_END: 2555, PARITY: 'S', NUM_SPACES: 2, HOUR_LIMIT: '.', PAY_ZONE: 6, PAY_AREA: 370, SUNDAY_HOURS: 'N' },
      geometry: { paths: [[[-87.71, 41.84], [-87.71, 41.8405]]] },
    });
    expect(b).toMatchObject({ blockId: 'B370603', hourLimit: null, sundayHours: 'N', spaces: 2, payArea: 370 });
    expect(b.bbox).toEqual([-87.71, 41.84, -87.71, 41.8405]);
  });
  it('pay box point', () => {
    const x = N.normPayBox({ attributes: { TERMINAL_ID: 257413, STREET_NAME: 'W RANDOLPH ST', BLOCK_START: 724, BLOCK_END: 740, PAYBOX_ADDR: 730, NUM_SPACES: 14, HOUR_LIMIT: '2', PAY_ZONE: 4, PAY_AREA: 257 }, geometry: { x: -87.647, y: 41.8845 } });
    expect(x).toMatchObject({ terminalId: 257413, hourLimit: '2', point: [-87.647, 41.8845] });
  });
  it('sweep zone builds ward_section from ward + section', () => {
    const z = N.normSweepZone({ ward: '1', section: '3', the_geom: { type: 'MultiPolygon', coordinates: [[[[-87.7, 41.9], [-87.69, 41.9], [-87.69, 41.91], [-87.7, 41.9]]]] } });
    expect(z?.wardSection).toBe('0103');
    expect(z?.bbox[0]).toBe(-87.7);
    expect(N.normSweepZone({ ward: '1', section: '3' })).toBeNull();
  });
  it('sweep row parses date list', () => {
    expect(N.normSweepRow({ ward_section_concatenated: '0101', month_number: '6', dates: '26, 29' })).toEqual({ wardSection: '0101', month: 6, days: [26, 29] });
    expect(N.normSweepRow({ ward_section_concatenated: '0101', month_number: '6', dates: '' }).days).toEqual([]);
  });
  it('permit: timestamps normalized, bagging flag, point', () => {
    const p = N.normPermit({ uniquekey: '1', applicationtype: 'DOT_PWO', worktypedescription: 'Opening', applicationstartdate: '2026-10-01T00:00:00.000', applicationenddate: '2026-10-30T23:59:59.000', streetnumberfrom: '3950', streetnumberto: '3950', direction: 'W', streetname: 'ROSEMONT', suffix: 'AVE', streetclosure: 'Sidewalk', parkingmeterpostingorbagging: 'Y', primarycontactlast: 'Peoples Gas*', latitude: '41.99', longitude: '-87.72' }, 'current');
    expect(p).toMatchObject({ id: '1', dataset: 'current', start: '2026-10-01T00:00:00', end: '2026-10-30T23:59:59', meterBagging: true, applicant: 'Peoples Gas*', location: '3950 W ROSEMONT AVE', point: [-87.72, 41.99] });
    expect(N.normPermit({ uniquekey: '2', latitude: '0', longitude: '0' }, 'closures').point).toBeNull();
  });
  it('filming permits (no uniquekey) get a per-segment id from applicationnumber', () => {
    const seg = (from: string, to: string, dir: string, street: string) => N.normPermit({ applicationnumber: '2206656', applicationstartdate: '2027-01-08T00:00:00.000', applicationenddate: '2027-01-09T23:59:59.000', streetnumberfrom: from, streetnumberto: to, direction: dir, streetname: street, suffix: 'ST', latitude: '41.869', longitude: '-87.625' }, 'filming');
    const a = seg('68', '80', 'E', '11TH'), b = seg('1100', '1158', 'S', 'WABASH');
    expect(a.id).toBe('2206656:68-80:E:11TH');
    expect(b.id).not.toBe(a.id);
    expect(a.id).not.toContain('undefined');
  });
  it('permit zone parses ranges and parity', () => {
    expect(N.normPermitZone({ status: 'ACTIVE', zone: '1130', odd_even: 'O', address_range_low: '1363', address_range_high: '1425', street_direction: 'W', street_name: 'Wilson ', street_type: 'AVE' }))
      .toEqual({ zone: '1130', oddEven: 'O', low: 1363, high: 1425, dir: 'W', name: 'WILSON', type: 'AVE' });
    expect(N.normPermitZone({ status: 'INACTIVE', zone: '1' })).toBeNull();
  });
  it('event and 311', () => {
    expect(N.normEvent({ date: '2026-06-28T00:00:00.000', venue_address: '11500 S LOOMIS', event_type: 'Block Party', event_details: 'Juneteenth', start_time: 'N/A', location: { type: 'Point', coordinates: [-87.65, 41.68] } }))
      .toMatchObject({ date: '2026-06-28', type: 'Block Party', point: [-87.65, 41.68] });
    expect(N.norm311({ sr_number: 'SR1', sr_type: 'Pothole in Street Complaint', status: 'Open', created_date: '2026-10-01T10:00:00.000', street_address: '1 N STATE ST', duplicate: true, latitude: '41.88', longitude: '-87.62' }))
      .toMatchObject({ id: 'SR1', duplicate: true, created: '2026-10-01T10:00:00', closed: null, point: [-87.62, 41.88] });
  });
  it('permit window where clause', () => {
    expect(N.permitWindowWhere('2026-10-11')).toBe("applicationenddate >= '2026-10-10T00:00:00' AND applicationstartdate <= '2026-12-10T23:59:59'");
  });
  it('parcel centroid', () => {
    expect(N.normParcel({ attributes: { L_ADDR: 706, H_ADDR: 706, PRE_DIR: 'W', ST_NAME: 'RANDOLPH', ST_TYPE: 'ST' }, geometry: { rings: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } }))
      .toEqual({ low: 706, high: 706, dir: 'W', name: 'RANDOLPH', type: 'ST', centroid: [1, 1] });
  });
});

describe('normSnowRouteRow (Socrata i6k4-giaj)', () => {
  it('maps LineString and MultiLineString geometry to paths with a bbox, skips rows without geometry', () => {
    const multi = N.normSnowRouteRow({ objectid: '1', on_street: 'W 111TH ST', restrict_t: '2 INCH', the_geom: { type: 'MultiLineString', coordinates: [[[-87.66, 41.69], [-87.65, 41.69]], [[-87.65, 41.69], [-87.64, 41.70]]] } })!;
    expect(multi.id).toBe('1:W 111TH ST');
    expect(multi.paths).toHaveLength(2);
    expect(multi.bbox).toEqual([-87.66, 41.69, -87.64, 41.70]);
    const single = N.normSnowRouteRow({ objectid: '2', on_street: 'X', the_geom: { type: 'LineString', coordinates: [[-87.6, 41.8], [-87.5, 41.8]] } })!;
    expect(single.paths).toEqual([[[-87.6, 41.8], [-87.5, 41.8]]]);
    expect(N.normSnowRouteRow({ objectid: '3', on_street: 'Y' })).toBeNull();
  });
});
