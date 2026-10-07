import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CrmProductBody,
  createCrmProduct,
  deleteCrmProduct,
  getCrmProduct,
  getCrmProducts,
  updateCrmProduct,
} from '@/api/crm-products';
import { useEnvironment } from '@/context/environment/hooks';
import { QueryKeys } from '@/utils/query-keys';

// izipush-crm — hooks du catalogue produits.

export function useCrmProducts() {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmProducts, currentEnvironment?._id],
    queryFn: ({ signal }) => getCrmProducts({ environment: currentEnvironment!, signal }),
    enabled: !!currentEnvironment?._id,
  });
}

export function useCrmProduct(productId?: string, days?: number) {
  const { currentEnvironment } = useEnvironment();

  return useQuery({
    queryKey: [QueryKeys.fetchCrmProduct, currentEnvironment?._id, productId, days],
    queryFn: ({ signal }) => getCrmProduct({ environment: currentEnvironment!, productId: productId!, days, signal }),
    enabled: !!currentEnvironment?._id && !!productId,
  });
}

/** Le catalogue nourrit aussi le constructeur de segments : ses champs sont invalidés avec lui. */
function useInvalidateProducts() {
  const { currentEnvironment } = useEnvironment();
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmProducts, currentEnvironment?._id] }),
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmProduct, currentEnvironment?._id] }),
      queryClient.invalidateQueries({ queryKey: [QueryKeys.fetchCrmFields, currentEnvironment?._id] }),
    ]);
}

export function useCreateCrmProduct() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (body: CrmProductBody) => createCrmProduct({ environment: currentEnvironment!, body }),
    onSuccess: invalidate,
  });
}

export function useUpdateCrmProduct() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: CrmProductBody }) =>
      updateCrmProduct({ environment: currentEnvironment!, productId, body }),
    onSuccess: invalidate,
  });
}

export function useDeleteCrmProduct() {
  const { currentEnvironment } = useEnvironment();
  const invalidate = useInvalidateProducts();

  return useMutation({
    mutationFn: (productId: string) => deleteCrmProduct({ environment: currentEnvironment!, productId }),
    onSuccess: invalidate,
  });
}
