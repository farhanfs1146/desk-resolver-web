import { HttpHeaders } from '@angular/common/http';

import { pageFromHeaders, toParams } from './page';

describe('pageFromHeaders', () => {
  it('reads the metadata the API puts in headers', () => {
    const headers = new HttpHeaders({
      'X-Total-Count': '137',
      'X-Total-Pages': '6',
      'X-Page-Number': '2',
      'X-Page-Size': '25',
      'X-Has-Next': 'true',
    });

    const page = pageFromHeaders(headers, [{ id: 1 }, { id: 2 }]);

    expect(page.totalCount).toBe(137);
    expect(page.totalPages).toBe(6);
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(25);
    expect(page.hasNext).toBe(true);
    expect(page.items.length).toBe(2);
  });

  it('treats anything but the string "true" as no next page', () => {
    const headers = new HttpHeaders({ 'X-Has-Next': 'false' });
    expect(pageFromHeaders(headers, []).hasNext).toBe(false);
    expect(pageFromHeaders(new HttpHeaders(), []).hasNext).toBe(false);
  });

  it('renders as an empty page rather than NaN when the headers are missing', () => {
    // This is the misconfiguration case: the headers exist on the response but the browser cannot
    // read them because they are absent from the backend's CORS exposedHeaders. It must look empty,
    // not broken - a paginator bound to NaN throws.
    const page = pageFromHeaders(new HttpHeaders(), [{ id: 1 }]);

    expect(page.totalCount).toBe(1);
    expect(page.pageNumber).toBe(0);
    expect(Number.isNaN(page.totalCount)).toBe(false);
  });

  it('survives an unparseable header', () => {
    const headers = new HttpHeaders({ 'X-Total-Count': 'lots' });
    expect(pageFromHeaders(headers, [{ id: 1 }]).totalCount).toBe(1);
  });

  it('copes with headers that have not arrived yet', () => {
    // httpResource().headers() is undefined until the first response lands, and the table renders
    // during that gap.
    const page = pageFromHeaders(undefined, []);
    expect(page.totalCount).toBe(0);
    expect(page.items).toEqual([]);
  });
});

describe('toParams', () => {
  it('keeps values and stringifies them', () => {
    const params = toParams({ page: 0, size: 25, status: 'OPEN', flag: false });

    expect(params.get('page')).toBe('0');
    expect(params.get('size')).toBe('25');
    expect(params.get('status')).toBe('OPEN');
    expect(params.get('flag')).toBe('false');
  });

  it('drops undefined, null and empty values entirely', () => {
    // Not cosmetic: `status=` binds to an empty string server-side rather than to "no filter", and
    // on an enum parameter that is a 400. A cleared filter has to vanish from the query string.
    const params = toParams({ status: undefined, priority: null, sort: '', page: 0 });

    expect(params.has('status')).toBe(false);
    expect(params.has('priority')).toBe(false);
    expect(params.has('sort')).toBe(false);
    expect(params.has('page')).toBe(true);
  });
});
